import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
// Internal modules of the PINNED @actions/cache (exact version in
// package.json; bundled into dist/ at release, so consumers never resolve it
// again). These internals — not the public restoreCache() — are what let us
// send our own (key, version) pair: the twirp v2 cache service takes both as
// plain request parameters, and the path-derived version hash is purely
// client-side convention. Driving these endpoints directly with the job's
// ACTIONS_RUNTIME_TOKEN is established practice (docker buildx
// `--cache-from type=gha` and sccache's GHA backend speak to the same
// service); the real risk is protocol churn — the v1 REST API was sunset in
// 2025 in favor of this twirp service — which pinning + bundling mitigates.
//
// Verified against @actions/cache 5.2.0 sources:
//   - internalCacheTwirpClient (lib/internal/shared/cacheTwirpClient.js:171,
//     auth via getRuntimeToken() = ACTIONS_RUNTIME_TOKEN at :34, base URL via
//     config.getCacheServiceURL() = ACTIONS_RESULTS_URL at :35) — both env
//     vars are injected by the runner into every job step; no workflow
//     `permissions:` needed (the cache does not use GITHUB_TOKEN).
//   - GetCacheEntryDownloadURL({key, restoreKeys, version}) ->
//     {ok, signedDownloadUrl, matchedKey}
//     (lib/generated/results/api/v1/cache.d.ts). !ok is a miss; the service
//     resolves the exact key first, then the restore keys by prefix — the
//     flow mirrors restoreCacheV2 in lib/cache.js.
//   - cacheHttpClient.downloadCache(signedDownloadUrl, archivePath,
//     {useAzureSdk: true}) routes Azure blob URLs to
//     downloadUtils.downloadCacheStorageSDK
//     (lib/internal/cacheHttpClient.js, downloadCache).
//   - config.getCacheServiceVersion() (lib/internal/config.js:18-24) gates
//     v2 on the runner-set ACTIONS_CACHE_SERVICE_V2 flag and always reports
//     v1 on GHES; this action supports only the v2 service (github.com).
import * as cacheHttpClient from '@actions/cache/lib/internal/cacheHttpClient';
import {getCacheServiceVersion} from '@actions/cache/lib/internal/config';
import {internalCacheTwirpClient} from '@actions/cache/lib/internal/shared/cacheTwirpClient';
import {handoffKey, handoffRestorePrefix, handoffVersion, validateName} from './lib';
import {unpackFromFile} from './xfer';

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

async function run(): Promise<void> {
	const serviceVersion = getCacheServiceVersion();
	if (serviceVersion !== 'v2') {
		throw new Error(`cache-download requires the v2 cache service (github.com); this runner reports '${serviceVersion}'. GHES is not supported.`);
	}

	const name = core.getInput('name', {required: true});
	const pathInput = core.getInput('path');
	const failOnCacheMiss = core.getBooleanInput('fail-on-cache-miss');
	validateName(name);

	// Artifact parity: the destination is a real directory of the consumer's
	// choosing, defaulting to the workspace. Nothing about it needs to match
	// what the producer passed to cache-upload.
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const destination = path.resolve(workspace, expandTilde(pathInput || '.'));

	const runId = requireEnv('GITHUB_RUN_ID');
	const key = handoffKey(name, runId, process.env.GITHUB_RUN_ATTEMPT || '1');
	const restorePrefix = handoffRestorePrefix(name, runId);
	const version = handoffVersion();

	const twirpClient = internalCacheTwirpClient();
	const lookup = await twirpClient.GetCacheEntryDownloadURL({key, restoreKeys: [restorePrefix], version});
	if (!lookup.ok) {
		core.setOutput('cache-hit', 'false');
		core.setOutput('cache-matched-key', '');
		core.setOutput('download-path', '');
		const message = `Hand-off '${name}' was not found for this workflow run (key ${key})`;
		if (failOnCacheMiss) {
			core.setFailed(`${message}. Did the producing job run cache-upload with the same name?`);
		} else {
			core.info(`${message}; continuing (fail-on-cache-miss is false)`);
		}
		return;
	}

	const exactHit = lookup.matchedKey === key;
	core.info(`Hand-off '${name}' matched key ${lookup.matchedKey}${exactHit ? '' : ' (earlier attempt of this run)'}`);

	const tempDir = await fsp.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'cache-xfer-'));
	const archivePath = path.join(tempDir, 'handoff.wxfr');
	try {
		await cacheHttpClient.downloadCache(lookup.signedDownloadUrl, archivePath, {useAzureSdk: true});
		const header = await unpackFromFile(archivePath, destination);
		core.info(`Restored hand-off '${name}' (${header.mode}) into ${destination}`);
	} finally {
		await fsp.rm(tempDir, {recursive: true, force: true});
	}

	core.setOutput('cache-hit', String(exactHit));
	core.setOutput('cache-matched-key', lookup.matchedKey);
	core.setOutput('download-path', destination);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
