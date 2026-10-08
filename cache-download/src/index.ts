import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
// Internal modules of the pinned @actions/cache (exact version in package.json; bundled into dist/ at release).
import * as cacheHttpClient from '@actions/cache/lib/internal/cacheHttpClient';
import {getCacheServiceVersion} from '@actions/cache/lib/internal/config';
import {internalCacheTwirpClient} from '@actions/cache/lib/internal/shared/cacheTwirpClient';
import {ambiguityMessage, distinctHandoffNames} from './discovery';
import {handoffKey, handoffRestorePrefix, handoffVersion, legacyHandoffKey, legacyHandoffRestorePrefix, legacyHandoffVersion, nameFromKey, runRestorePrefix, validateName} from '../../_shared/cache-xfer/lib';
import {MissOutcome, missOutcome, namelessMissOutcome} from './miss';
import {CorruptArchiveError, unpackFromFile} from '../../_shared/cache-xfer/xfer';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Required environment variable ${name} is not set`);
	}
	return value;
}

function expandTilde(p: string): string {
	if (p === '~') {
		return os.homedir();
	}
	if (p.startsWith('~/')) {
		return path.join(os.homedir(), p.slice(2));
	}
	return p;
}

interface TwirpLookup {
	ok: boolean;
	signedDownloadUrl: string;
	matchedKey: string;
}

interface TwirpClient {
	GetCacheEntryDownloadURL(req: {key: string; restoreKeys: string[]; version: string}): Promise<TwirpLookup>;
}

/**
 * List this run's hand-off cache keys via the documented public REST API
 * (the endpoint cache-cleanup uses; the twirp client has no list RPC).
 * Plain fetch — no octokit dependency needed for one paginated GET.
 */
async function listRunCacheKeys(token: string, runPrefix: string): Promise<string[]> {
	const api = process.env.GITHUB_API_URL || 'https://api.github.com';
	const repo = requireEnv('GITHUB_REPOSITORY');
	const keys: string[] = [];
	for (let page = 1; page <= 10; page++) {
		const url = `${api}/repos/${repo}/actions/caches?key=${encodeURIComponent(runPrefix)}&per_page=100&page=${page}`;
		const resp = await fetch(url, {
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28'
			}
		});
		if (!resp.ok) {
			throw new Error(`GET /actions/caches returned HTTP ${resp.status}`);
		}
		const body = (await resp.json()) as {actions_caches?: Array<{key?: string}>};
		const batch = (body.actions_caches ?? []).map(e => e.key).filter((k): k is string => typeof k === 'string');
		keys.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}
	return keys;
}

/** What the lookup phase resolved (or failed to resolve). */
interface Resolution {
	lookup: TwirpLookup;
	/** The hand-off name, when known before download (named mode / listed discovery). */
	name?: string;
	/** TRANSITION: true when the pre-v2 legacy layout satisfied a named lookup. */
	legacy: boolean;
	miss: MissOutcome;
}

/** Named mode: exact v2 key, v2 prefix, then the TRANSITION legacy fallback. */
async function resolveNamed(twirpClient: TwirpClient, name: string, runId: string, runAttempt: string, failIfMissing: boolean): Promise<Resolution> {
	const key = handoffKey(name, runId, runAttempt);
	const restorePrefix = handoffRestorePrefix(name, runId);
	let lookup = await twirpClient.GetCacheEntryDownloadURL({key, restoreKeys: [restorePrefix], version: handoffVersion()});
	let legacy = false;
	if (!lookup.ok) {
		// TRANSITION fallback (remove after the v2 rollout): a producer still on
		// the pre-v2 cache-upload. That cache-upload is saved under the
		// name-first layout and the v1 version. #latest tags move on merge.
		lookup = await twirpClient.GetCacheEntryDownloadURL({
			key: legacyHandoffKey(name, runId, runAttempt),
			restoreKeys: [legacyHandoffRestorePrefix(name, runId)],
			version: legacyHandoffVersion()
		});
		legacy = lookup.ok;
		if (legacy) {
			core.warning(`Hand-off '${name}' was found under the pre-v2 legacy key layout (${lookup.matchedKey}); the producing job ran an older cache-upload. This fallback exists only for the rollout and will be removed.`);
		}
	}
	return {lookup, name, legacy, miss: missOutcome(name, key, restorePrefix, failIfMissing)};
}

/** Nameless mode: discover this run's single hand-off by the run-scoped
 * prefix. When listing is unavailable the newest run-scoped entry is
 * restored and a warning says the check was skipped. There is deliberately
 * NO legacy-layout fallback here: a nameless old-layout prefix search is
 * exactly the cross-run bug v2 fixed. */
async function resolveNameless(twirpClient: TwirpClient, runId: string, runAttempt: string, failIfMissing: boolean): Promise<Resolution | 'ambiguous'> {
	const runPrefix = runRestorePrefix(runId);
	let discovered: string | undefined;
	const token = core.getInput('github-token');
	if (token) {
		try {
			const names = distinctHandoffNames(await listRunCacheKeys(token, runPrefix), runId);
			if (names.length > 1) {
				core.setFailed(ambiguityMessage(names));
				return 'ambiguous';
			}
			discovered = names[0];
		} catch (error) {
			core.warning(`Could not list this run's hand-offs to check for ambiguity (${error instanceof Error ? error.message : String(error)}). Restoring the newest run-scoped entry; runs with multiple hand-offs should pass an explicit 'name'.`);
		}
	} else {
		core.warning("No github-token available for the ambiguity check. Restoring the newest run-scoped entry; runs with multiple hand-offs should pass an explicit 'name'.");
	}

	// With a discovered name the request mirrors named mode (exact key for
	// this attempt, then the name-scoped prefix); without one the bare
	// run-scoped prefix restores the newest entry of this run.
	const request = discovered === undefined
		? {key: runPrefix, restoreKeys: [runPrefix], version: handoffVersion()}
		: {key: handoffKey(discovered, runId, runAttempt), restoreKeys: [handoffRestorePrefix(discovered, runId)], version: handoffVersion()};
	const lookup = await twirpClient.GetCacheEntryDownloadURL(request);
	return {lookup, name: discovered, legacy: false, miss: namelessMissOutcome(runPrefix, failIfMissing)};
}

async function run(): Promise<void> {
	const serviceVersion = getCacheServiceVersion();
	if (serviceVersion !== 'v2') {
		throw new Error(`cache-download requires the v2 cache service (github.com); this runner reports '${serviceVersion}'. GHES is not supported.`);
	}

	const nameInput = core.getInput('name');
	const pathInput = core.getInput('path');
	const failIfMissing = core.getBooleanInput('fail-if-missing');
	if (nameInput) {
		validateName(nameInput);
	}

	// Artifact parity: the destination is a real directory of the consumer's choosing, defaulting to the workspace.
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const destination = path.resolve(workspace, expandTilde(pathInput || '.'));

	const runId = requireEnv('GITHUB_RUN_ID');
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';

	const twirpClient = internalCacheTwirpClient();
	const resolved = nameInput
		? await resolveNamed(twirpClient, nameInput, runId, runAttempt, failIfMissing)
		: await resolveNameless(twirpClient, runId, runAttempt, failIfMissing);
	if (resolved === 'ambiguous') {
		return;
	}

	if (!resolved.lookup.ok) {
		core.setOutput('cache-hit', 'false');
		core.setOutput('cache-matched-key', '');
		core.setOutput('download-path', '');
		core.setOutput('name', '');
		if (resolved.miss.fail) {
			core.setFailed(resolved.miss.message);
		} else {
			core.info(resolved.miss.message);
		}
		return;
	}

	const matchedKey = resolved.lookup.matchedKey;
	if (resolved.name) {
		core.info(`Hand-off '${resolved.name}' matched key ${matchedKey}`);
	}

	const tempDir = await fsp.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'cache-xfer-'));
	const archivePath = path.join(tempDir, 'handoff.wxfr');
	let resolvedName: string;
	try {
		// Explicitly upstream's own defaults, NOT the Azure SDK path — see the downloadCache note in the header comment for why.
		await cacheHttpClient.downloadCache(resolved.lookup.signedDownloadUrl, archivePath, {useAzureSdk: false, concurrentBlobDownloads: true});
		let header;
		try {
			header = await unpackFromFile(archivePath, destination);
		} catch (error) {
			if (!(error instanceof CorruptArchiveError)) {
				throw error;
			}
			// The bytes on hand are not the bytes that were uploaded.
			core.warning(`${error.message}. Treating hand-off ${matchedKey} as a miss.`);
			core.setOutput('cache-hit', 'false');
			core.setOutput('cache-matched-key', '');
			core.setOutput('download-path', '');
			core.setOutput('name', '');
			return;
		}
		// The envelope is the authority on the name.
		resolvedName = header.name ?? resolved.name ?? nameFromKey(matchedKey, runId) ?? '';
		core.info(`Restored hand-off '${resolvedName}' (${header.mode}) into ${destination}`);
	} finally {
		await fsp.rm(tempDir, {recursive: true, force: true});
	}

	if (!nameInput) {
		core.notice(`cache-download picked hand-off '${resolvedName}' for this run (key ${matchedKey})`);
	}

	// Exact hit = this attempt's own key (either layout during the TRANSITION); a prefix match means an earlier attempt's entry.
	const exactHit = resolvedName !== '' && (matchedKey === handoffKey(resolvedName, runId, runAttempt) || matchedKey === legacyHandoffKey(resolvedName, runId, runAttempt));
	if (!exactHit) {
		core.info('Matched an earlier attempt of this run');
	}
	core.setOutput('cache-hit', String(exactHit));
	core.setOutput('cache-matched-key', matchedKey);
	core.setOutput('download-path', destination);
	core.setOutput('name', resolvedName);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
