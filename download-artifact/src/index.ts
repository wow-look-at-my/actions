// Cache-backed download-artifact: the counterpart to this repo's cache-backed
// upload-artifact. Restores the payload tar from the Actions cache service
// and extracts it to the requested path. A restore miss is NEVER silent: a
// three-step REST diagnosis names the most likely cause before failing.
//
// Input surface mirrors actions/download-artifact@v4 (MIT License,
// Copyright GitHub, Inc. and contributors).

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {buildMissVerdict, missingNameMessage, rejectUnsupportedInputs, repoMismatchMessage} from './lib';
import {
	attemptFromKey,
	attemptKeyPrefix,
	buildCacheKey,
	CacheEntry,
	CacheUsage,
	extractPayload,
	formatBytes,
	formatGB,
	ghRest,
	KEY_VERSION,
	listPayloadFiles,
	parseCacheList,
	parseCacheUsage,
	PAYLOAD_DIR,
	PAYLOAD_PATH,
	readPayloadMeta,
	sha256File,
	sleep
} from './shared';

/** ghRest that reports (never throws) REST failures -- the diagnosis must degrade gracefully. */
async function ghRestSafe(
	method: string,
	pathAndQuery: string,
	token: string
): Promise<{status: number; body: unknown} | undefined> {
	try {
		return await ghRest(method, pathAndQuery, token);
	} catch (err) {
		core.info(`REST diagnosis call failed: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
}

/**
 * restoreCache with ONE flat retry on a THROWN error (never on a clean miss,
 * never with backoff). The lib swallows most transient failures into a miss
 * itself, so this trips rarely.
 */
async function restoreWithOneFlatRetry(exactKey: string, prefix: string): Promise<string | undefined> {
	try {
		return await cache.restoreCache([PAYLOAD_PATH], exactKey, [prefix]);
	} catch (err) {
		if (err instanceof cache.ValidationError) {
			throw err;
		}
		const msg = err instanceof Error ? err.message : String(err);
		core.warning(`restoreCache threw (${msg}); retrying once after 3s (single flat retry)`);
		await sleep(3000);
		return await cache.restoreCache([PAYLOAD_PATH], exactKey, [prefix]);
	}
}

/** The LOUD three-step miss diagnosis: sequential REST reads, each degrading gracefully, then setFailed. */
async function diagnoseMiss(
	repo: string,
	name: string,
	exactKey: string,
	runId: string,
	token: string
): Promise<void> {
	core.error(`Cache-backed artifact "${name}" was NOT restored (cache miss). Running the miss diagnosis...`);
	const currentRef = process.env.GITHUB_REF;

	// (1) Does the exact key exist anywhere (i.e. on a ref this run cannot restore from)?
	let entriesForKey: CacheEntry[] | undefined;
	const exactRes = await ghRestSafe(
		'GET',
		`/repos/${repo}/actions/caches?key=${encodeURIComponent(exactKey)}&per_page=100`,
		token
	);
	if (exactRes && exactRes.status === 200) {
		entriesForKey = parseCacheList(exactRes.body);
		if (entriesForKey.length > 0) {
			for (const e of entriesForKey) {
				core.info(
					`Entry for the exact key: ref ${e.ref}, created ${e.created_at}, ${formatBytes(e.size_in_bytes)}, cache version ${e.version}`
				);
			}
			core.info(
				`Branch scoping: a cache saved on ref R is restorable from R, PRs based on R, or the default branch -- this run's ref is ${currentRef ?? 'unknown'}`
			);
		} else {
			core.info('No cache entry holds the exact key on any ref.');
		}
	} else if (exactRes) {
		core.info(
			`Exact-key listing unavailable (HTTP ${exactRes.status})${
				exactRes.status === 401 || exactRes.status === 403 || exactRes.status === 404
					? ' -- grant the github-token actions: read for full miss diagnostics'
					: ''
			}`
		);
	}

	// (2) What DID this run save? Catches name typos.
	let runEntries: CacheEntry[] | undefined;
	const runPrefix = `${KEY_VERSION}-${runId}-`;
	const runRes = await ghRestSafe(
		'GET',
		`/repos/${repo}/actions/caches?key=${encodeURIComponent(runPrefix)}&per_page=100`,
		token
	);
	if (runRes && runRes.status === 200) {
		runEntries = parseCacheList(runRes.body);
		if (runEntries.length > 0) {
			core.info(`Cache-backed artifact keys saved by run ${runId}:`);
			for (const e of runEntries) {
				core.info(`  ${e.key} (ref ${e.ref}, created ${e.created_at}, ${formatBytes(e.size_in_bytes)})`);
			}
		} else {
			core.info(`Run ${runId} saved no cache-backed artifact keys at all (prefix ${runPrefix}).`);
		}
	} else if (runRes) {
		core.info(`Run-prefix listing unavailable (HTTP ${runRes.status})`);
	}

	// (3) Usage: was the entry LRU-evicted?
	let usage: CacheUsage | undefined;
	const usageRes = await ghRestSafe('GET', `/repos/${repo}/actions/cache/usage`, token);
	if (usageRes && usageRes.status === 200) {
		usage = parseCacheUsage(usageRes.body);
		if (usage) {
			core.info(
				`Repo cache at ${formatGB(usage.active_caches_size_in_bytes)} / ~10 GB (${usage.active_caches_count} entries); ` +
					'if the save succeeded earlier, the entry may have been LRU-evicted -- restore sooner after saving or shrink artifacts.'
			);
		}
	} else if (usageRes) {
		core.info(`Cache usage unavailable (HTTP ${usageRes.status})`);
	}

	core.setFailed(buildMissVerdict({name, exactKey, runId, currentRef, entriesForKey, runEntries, usage}));
}

async function run(): Promise<void> {
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	// restoreCache extracts relative to the workspace; make cwd match so
	// relative resolution can never diverge.
	process.chdir(workspace);

	const name = core.getInput('name');
	const rawPath = core.getInput('path');
	const token = core.getInput('github-token');
	const runIdInput = core.getInput('run-id');
	const repository = core.getInput('repository');
	const currentRepo = process.env.GITHUB_REPOSITORY || '';

	const unsupported = rejectUnsupportedInputs({
		pattern: core.getInput('pattern'),
		mergeMultiple: core.getBooleanInput('merge-multiple'),
		artifactIds: core.getInput('artifact-ids')
	});
	if (unsupported) {
		core.setFailed(unsupported);
		return;
	}
	if (repository && currentRepo && repository !== currentRepo) {
		core.setFailed(repoMismatchMessage(repository, currentRepo));
		return;
	}
	if (!name) {
		core.setFailed(missingNameMessage());
		return;
	}

	const runId = runIdInput || process.env.GITHUB_RUN_ID || '';
	if (!/^\d+$/.test(runId)) {
		core.setFailed(`run-id must be a numeric workflow run id, got "${runId}"`);
		return;
	}
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';

	// Resolve the destination like upstream download-artifact: default is the
	// workspace, basic tilde expansion, relative paths against the workspace.
	let target = rawPath || workspace;
	if (target === '~' || target.startsWith('~/')) {
		target = path.join(os.homedir(), target.slice(1));
	}
	const targetAbs = path.resolve(workspace, target);

	const exactKey = buildCacheKey(runId, runAttempt, name);
	const prefix = attemptKeyPrefix(runId, name);
	core.info(`Restoring cache-backed artifact "${name}"`);
	core.info(`Exact key: ${exactKey} (cross-attempt fallback prefix: ${prefix})`);

	const stagingAbs = path.join(workspace, PAYLOAD_DIR);
	try {
		// A leftover payload from an earlier step must not shadow this restore.
		fs.rmSync(stagingAbs, {recursive: true, force: true});

		const matched = await restoreWithOneFlatRetry(exactKey, prefix);
		if (matched === undefined) {
			await diagnoseMiss(currentRepo, name, exactKey, runId, token);
			return;
		}

		if (matched === exactKey) {
			core.info(`Cache hit on the exact key (run ${runId}, attempt ${runAttempt})`);
		} else {
			const attempt = attemptFromKey(matched, runId, name);
			core.info(
				`Cache hit via the cross-attempt prefix: ${matched}${attempt ? ` (saved by run attempt ${attempt})` : ''}`
			);
		}

		const payloadAbs = path.join(workspace, PAYLOAD_PATH);
		const meta = readPayloadMeta(payloadAbs);
		core.info(
			`Artifact meta: "${meta.name}" saved by run ${meta.runId} attempt ${meta.runAttempt} of ${meta.repo} at ${meta.createdAt}; ${meta.fileCount} files, ${formatBytes(meta.totalBytes)}`
		);
		const digest = await sha256File(payloadAbs);
		core.info(`Payload sha256: ${digest}`);

		extractPayload(payloadAbs, targetAbs);
		const extracted = listPayloadFiles(payloadAbs);
		core.info(
			`Extracted ${extracted.length} file${extracted.length === 1 ? '' : 's'} (${formatBytes(meta.totalBytes)}) to ${targetAbs}`
		);

		core.setOutput('download-path', targetAbs);
	} finally {
		// The staging dir must never pollute the workspace, success or failure.
		fs.rmSync(stagingAbs, {recursive: true, force: true});
	}
}

run().catch((error) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
