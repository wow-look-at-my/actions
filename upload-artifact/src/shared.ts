// Shared mechanics of the cache-backed artifact pair (upload-artifact and
// download-artifact in wow-look-at-my/actions).
//
// THIS FILE IS DUPLICATED BYTE-FOR-BYTE as upload-artifact/src/shared.ts and
// download-artifact/src/shared.ts. The two actions are published as
// independent orphan tags and cannot import each other, so each ships its own
// copy; a test in download-artifact asserts byte-equality of the two files.
//
// COMPATIBILITY CONTRACT: the cache key format (KEY_VERSION and the
// buildCacheKey layout) and the payload path/layout (PAYLOAD_PATH, META_NAME,
// the tar shape) are a contract between independently-published actions. Any
// change to them breaks upload/download pairs that mix versions -- bump
// KEY_VERSION 'ghart-v1' -> 'ghart-v2' in BOTH directories in one PR.
//
// Portions of the surrounding actions are ported from actions/upload-artifact
// v4.6.2 and actions/toolkit @actions/artifact 2.3.2 (MIT License,
// Copyright GitHub, Inc. and contributors).

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {execFileSync} from 'child_process';

// ---------------------------------------------------------------------------
// Key scheme
// ---------------------------------------------------------------------------

/** Version prefix of every cache key this pair writes and reads. */
export const KEY_VERSION = 'ghart-v1';

/**
 * The staging directory and payload tar, as CONSTANT workspace-relative path
 * strings. The cache service hashes the paths array exactly as passed to
 * saveCache/restoreCache into the entry's "version"; save and restore must
 * pass byte-identical strings or the restore silently misses. A
 * workspace-relative constant is identical across jobs, runner layouts,
 * self-hosted runners, and OSes -- a $RUNNER_TEMP absolute path is not.
 */
export const PAYLOAD_DIR = '.gha-cache-artifact.tmp';
export const PAYLOAD_PATH = `${PAYLOAD_DIR}/payload.tar`;

/** Metadata entry inside the payload tar: always the first entry, excluded from extraction. */
export const META_NAME = '.gha-artifact-meta.json';

/**
 * Workflow triggers that may create/overwrite caches in the default branch's
 * scope (GitHub read-only-cache restriction, 2026-06-26). Runs from any other
 * trigger that resolves to the default branch (workflow_run,
 * pull_request_target, issue_comment, ...) get read-only cache access.
 */
export const CACHE_WRITER_EVENTS = [
	'push',
	'workflow_dispatch',
	'repository_dispatch',
	'delete',
	'registry_package',
	'page_build',
	'schedule'
];

/** True when the runner-declared cache mode forbids saves. */
export function cacheModeBlocksWrites(mode: string | undefined): boolean {
	return mode === 'read' || mode === 'none';
}

/**
 * Sanitize an artifact name for embedding in a cache key: commas are
 * forbidden in keys, control characters and whitespace become ambiguous --
 * all are replaced with '-', and the result is clamped to 100 characters.
 * Uniqueness does NOT depend on this (the fixed-length name hash does that);
 * the sanitized name is only the human-readable tail of the key.
 */
export function sanitizeName(name: string): string {
	return name.replace(/[,\s\u0000-\u001f\u007f]/g, '-').slice(0, 100);
}

/** First 16 hex chars of SHA-256(name) -- fixed length, which is what makes the attempt prefix collision-proof. */
export function nameHash16(name: string): string {
	return crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The exact cache key for one artifact of one run attempt:
 *   ghart-v1-<runId>-<sha256(name)[0..16]>-a<runAttempt>-<sanitized name>
 * The fixed-length name hash sits BEFORE the attempt marker, so the
 * cross-attempt restore prefix (attemptKeyPrefix) can never match a
 * different artifact name, no matter what dashes/digits the name contains.
 * Keys stay well under the 512-char cache limit and contain no commas.
 */
export function buildCacheKey(runId: string, runAttempt: string, name: string): string {
	return `${KEY_VERSION}-${runId}-${nameHash16(name)}-a${runAttempt}-${sanitizeName(name)}`;
}

/**
 * Restore-key prefix matching every attempt of the given run's saves of the
 * given artifact name (and nothing else): a re-run attempt restores the
 * newest previous attempt's entry through this prefix.
 */
export function attemptKeyPrefix(runId: string, name: string): string {
	return `${KEY_VERSION}-${runId}-${nameHash16(name)}-a`;
}

/**
 * Which run attempt saved a matched key, or undefined when the key does not
 * belong to (runId, name) or does not parse.
 */
export function attemptFromKey(key: string, runId: string, name: string): string | undefined {
	const prefix = attemptKeyPrefix(runId, name);
	if (!key.startsWith(prefix)) {
		return undefined;
	}
	const m = /^(\d+)-/.exec(key.slice(prefix.length));
	return m ? m[1] : undefined;
}

/**
 * The cache-service "version" values a payload saved by this action pair can
 * carry (sha256 of paths|compressionMethod[|windows-only]|salt, computed the
 * way @actions/cache does). Used only to diagnose misses: an entry whose key
 * matches but whose version is not in this set was saved with a different
 * payload path (broken contract) or compression availability.
 */
export function expectedCacheVersions(): string[] {
	const mk = (...components: string[]): string =>
		crypto.createHash('sha256').update([PAYLOAD_PATH, ...components, '1.0'].join('|')).digest('hex');
	return [
		mk('zstd-without-long'),
		mk('gzip'),
		mk('zstd-without-long', 'windows-only'),
		mk('gzip', 'windows-only')
	];
}

// ---------------------------------------------------------------------------
// Payload tar
// ---------------------------------------------------------------------------

/** Metadata document stored as the payload tar's first entry. */
export interface ArtifactMeta {
	formatVersion: number;
	name: string;
	runId: string;
	runAttempt: string;
	fileCount: number;
	totalBytes: number;
	createdAt: string;
	repo: string;
}

/**
 * Build the payload tar at <stagingAbs>/payload.tar: the meta document as the
 * first entry, then every relPath taken from rootAbs. Plain uncompressed tar
 * via the system tar binary (the cache layer compresses the whole payload).
 * The file list is a NUL-delimited manifest (--null -T), portable across
 * GNU tar, bsdtar, and Windows tar.exe, and immune to names with spaces or
 * leading dashes. Symlinks are dereferenced (-h): the target's bytes are
 * stored under the link's path, matching actions/upload-artifact@v4.
 */
export function buildPayloadTar(
	stagingAbs: string,
	rootAbs: string,
	relPaths: string[],
	meta: ArtifactMeta
): string {
	fs.mkdirSync(stagingAbs, {recursive: true});
	const payloadAbs = path.join(stagingAbs, 'payload.tar');
	const metaAbs = path.join(stagingAbs, META_NAME);
	const manifestAbs = path.join(stagingAbs, 'manifest');
	fs.writeFileSync(metaAbs, `${JSON.stringify(meta, null, '\t')}\n`);
	const manifest = relPaths.map((p) => `${p.replace(/\\/g, '/')}\u0000`).join('');
	fs.writeFileSync(manifestAbs, manifest);
	execFileSync(
		'tar',
		['-c', '-h', '-f', payloadAbs, '-C', stagingAbs, META_NAME, '-C', rootAbs, '--null', '-T', manifestAbs],
		{stdio: ['ignore', 'inherit', 'inherit']}
	);
	return payloadAbs;
}

/** Read the meta document out of a payload tar without extracting anything to disk. */
export function readPayloadMeta(payloadAbs: string): ArtifactMeta {
	const out = execFileSync('tar', ['-x', '-O', '-f', payloadAbs, META_NAME], {
		maxBuffer: 1024 * 1024
	});
	return JSON.parse(out.toString('utf8')) as ArtifactMeta;
}

/** Extract a payload tar into targetAbs (created if missing), excluding the meta entry. */
export function extractPayload(payloadAbs: string, targetAbs: string): void {
	fs.mkdirSync(targetAbs, {recursive: true});
	execFileSync('tar', ['-x', '-f', payloadAbs, '-C', targetAbs, '--exclude', META_NAME], {
		stdio: ['ignore', 'inherit', 'inherit']
	});
}

/** List the file entries of a payload tar (meta entry and directories excluded). */
export function listPayloadFiles(payloadAbs: string): string[] {
	const out = execFileSync('tar', ['-t', '-f', payloadAbs], {maxBuffer: 64 * 1024 * 1024});
	return out
		.toString('utf8')
		.split('\n')
		.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
		.filter((l) => l !== '' && l !== META_NAME && !l.endsWith('/'));
}

/** Streamed SHA-256 of a file (never reads the whole payload into memory). */
export function sha256File(fileAbs: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(fileAbs);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

// ---------------------------------------------------------------------------
// GitHub REST (cache management + diagnostics)
// ---------------------------------------------------------------------------

export interface RestResponse {
	status: number;
	body: unknown;
}

/**
 * Minimal GitHub REST call. Callers make these strictly SEQUENTIALLY (org
 * doctrine: one GitHub API call at a time) and treat non-2xx statuses as
 * data, not exceptions -- only a network-level failure throws.
 */
export async function ghRest(method: string, pathAndQuery: string, token: string): Promise<RestResponse> {
	const base = process.env.GITHUB_API_URL || 'https://api.github.com';
	const res = await fetch(`${base}${pathAndQuery}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
			'user-agent': 'wow-look-at-my-actions-cache-artifact'
		}
	});
	const text = await res.text();
	let body: unknown;
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	return {status: res.status, body};
}

/** One row of GET/DELETE /repos/{repo}/actions/caches responses. */
export interface CacheEntry {
	id: number;
	ref: string;
	key: string;
	version: string;
	created_at: string;
	size_in_bytes: number;
}

/** Defensive parse of a cache list/delete response body into entries. */
export function parseCacheList(body: unknown): CacheEntry[] {
	if (typeof body !== 'object' || body === null) {
		return [];
	}
	const caches = (body as {actions_caches?: unknown}).actions_caches;
	if (!Array.isArray(caches)) {
		return [];
	}
	return caches.map((c) => {
		const e = c as Partial<CacheEntry>;
		return {
			id: typeof e.id === 'number' ? e.id : 0,
			ref: typeof e.ref === 'string' ? e.ref : '',
			key: typeof e.key === 'string' ? e.key : '',
			version: typeof e.version === 'string' ? e.version : '',
			created_at: typeof e.created_at === 'string' ? e.created_at : '',
			size_in_bytes: typeof e.size_in_bytes === 'number' ? e.size_in_bytes : 0
		};
	});
}

/** GET /repos/{repo}/actions/cache/usage response. */
export interface CacheUsage {
	active_caches_count: number;
	active_caches_size_in_bytes: number;
}

/** Defensive parse of the cache usage response body. */
export function parseCacheUsage(body: unknown): CacheUsage | undefined {
	if (typeof body !== 'object' || body === null) {
		return undefined;
	}
	const u = body as Partial<CacheUsage>;
	if (typeof u.active_caches_count !== 'number' || typeof u.active_caches_size_in_bytes !== 'number') {
		return undefined;
	}
	return {
		active_caches_count: u.active_caches_count,
		active_caches_size_in_bytes: u.active_caches_size_in_bytes
	};
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatBytes(n: number): string {
	if (n >= 1024 * 1024 * 1024) {
		return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
	}
	if (n >= 1024 * 1024) {
		return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
	}
	if (n >= 1024) {
		return `${(n / 1024).toFixed(2)} KiB`;
	}
	return `${n} B`;
}

/** Decimal GB, the unit GitHub's ~10 GB cache cap is stated in. */
export function formatGB(n: number): string {
	return `${(n / 1e9).toFixed(2)} GB`;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
