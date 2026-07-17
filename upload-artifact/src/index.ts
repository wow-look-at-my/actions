// Cache-backed upload-artifact: a drop-in replacement for
// actions/upload-artifact@v4 that stores the artifact payload in the Actions
// CACHE service instead of the Actions artifact storage service, whose
// quota/billing behavior makes uploads fail unpredictably under a $0 storage
// budget (see README.md).
//
// Input semantics and the search flow are ported from actions/upload-artifact
// v4.6.2 (MIT License, Copyright GitHub, Inc. and contributors); the storage
// layer is @actions/cache.

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as fs from 'fs';
import * as path from 'path';
import {findFilesToUpload} from './search';
import {
	chooseSaveFailureDiagnosis,
	noFilesMessage,
	parseNoFilesBehavior,
	readOnlyCacheMessage,
	validateArtifactName,
	validateFilePath
} from './lib';
import {
	ArtifactMeta,
	buildCacheKey,
	buildPayloadTar,
	CacheEntry,
	cacheModeBlocksWrites,
	formatBytes,
	formatGB,
	ghRest,
	parseCacheList,
	parseCacheUsage,
	PAYLOAD_DIR,
	PAYLOAD_PATH,
	sha256File
} from './shared';

interface Inputs {
	name: string;
	searchPath: string;
	ifNoFilesFound: string;
	retentionDays: string;
	compressionLevel: string;
	overwrite: boolean;
	includeHiddenFiles: boolean;
	token: string;
}

function getInputs(): Inputs {
	return {
		name: core.getInput('name'),
		searchPath: core.getInput('path', {required: true}),
		ifNoFilesFound: core.getInput('if-no-files-found'),
		retentionDays: core.getInput('retention-days'),
		compressionLevel: core.getInput('compression-level'),
		overwrite: core.getBooleanInput('overwrite'),
		includeHiddenFiles: core.getBooleanInput('include-hidden-files'),
		token: core.getInput('token')
	};
}

/** Delete any existing cache entry for the key (overwrite: true). Best-effort: the save attempt still runs. */
async function deleteExistingEntry(repo: string, key: string, token: string): Promise<void> {
	core.info(`overwrite: true -- deleting any existing cache entry for key ${key}`);
	try {
		const res = await ghRest('DELETE', `/repos/${repo}/actions/caches?key=${encodeURIComponent(key)}`, token);
		if (res.status === 200) {
			const deleted = parseCacheList(res.body);
			for (const e of deleted) {
				core.info(
					`Deleted cache entry id ${e.id} (ref ${e.ref}, created ${e.created_at}, ${formatBytes(e.size_in_bytes)})`
				);
			}
			if (deleted.length === 0) {
				core.info('Delete succeeded but reported no entries');
			}
		} else if (res.status === 404) {
			core.info('No existing cache entry to overwrite');
		} else if (res.status === 403) {
			core.warning(
				'The token lacks actions: write, so the existing cache entry (if any) could not be deleted; continuing to the save attempt'
			);
		} else {
			core.warning(`Unexpected HTTP ${res.status} deleting the existing cache entry; continuing to the save attempt`);
		}
	} catch (err) {
		core.warning(
			`Failed to delete the existing cache entry (${err instanceof Error ? err.message : String(err)}); continuing to the save attempt`
		);
	}
}

async function run(): Promise<void> {
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	// saveCache hashes/globs the payload path relative to the workspace; make
	// cwd match so relative resolution can never diverge.
	process.chdir(workspace);

	const inputs = getInputs();
	const repo = process.env.GITHUB_REPOSITORY || '';
	const runId = process.env.GITHUB_RUN_ID || '';
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
	const eventName = process.env.GITHUB_EVENT_NAME;
	const cacheMode = process.env.ACTIONS_CACHE_MODE;

	validateArtifactName(inputs.name);

	const behavior = parseNoFilesBehavior(inputs.ifNoFilesFound);
	if (behavior === undefined) {
		core.setFailed(
			`Unrecognized if-no-files-found input. Provided: ${inputs.ifNoFilesFound}. Available options: warn,error,ignore`
		);
		return;
	}

	// Fail fast and LOUDLY when this run cannot write caches at all (the June
	// 2026 read-only-cache restriction for low-trust triggers). Without this,
	// saveCache degrades to a logged no-op returning -1 and the artifact is
	// silently lost.
	if (cacheModeBlocksWrites(cacheMode)) {
		core.setFailed(readOnlyCacheMessage(cacheMode as string, eventName));
		return;
	}

	if (!cache.isFeatureAvailable()) {
		core.setFailed(
			'The Actions cache service is not available in this environment, so a cache-backed artifact cannot be uploaded. This action only works inside GitHub Actions runs (the runner injects the cache-service credentials).'
		);
		return;
	}

	if (inputs.retentionDays) {
		const days = parseInt(inputs.retentionDays);
		if (isNaN(days)) {
			core.setFailed('Invalid retention-days');
			return;
		}
		core.info(
			'retention-days is accepted for compatibility but IGNORED: the cache service self-manages retention (entries unused for ~7 days are evicted, and the ~10 GB repo cap evicts least-recently-used entries first).'
		);
	}
	if (inputs.compressionLevel) {
		const level = parseInt(inputs.compressionLevel);
		if (isNaN(level)) {
			core.setFailed('Invalid compression-level');
			return;
		}
		if (level < 0 || level > 9) {
			core.setFailed('Invalid compression-level. Valid values are 0-9');
			return;
		}
		core.info(
			'compression-level is accepted for compatibility but IGNORED: the cache layer already zstd-compresses the payload on upload.'
		);
	}

	const searchResult = await findFilesToUpload(inputs.searchPath, inputs.includeHiddenFiles);
	if (searchResult.filesToUpload.length === 0) {
		switch (behavior) {
			case 'warn':
				core.warning(noFilesMessage(inputs.searchPath));
				break;
			case 'error':
				core.setFailed(noFilesMessage(inputs.searchPath));
				break;
			case 'ignore':
				core.info(noFilesMessage(inputs.searchPath));
				break;
		}
		return;
	}

	const s = searchResult.filesToUpload.length === 1 ? '' : 's';
	core.info(`With the provided path, there will be ${searchResult.filesToUpload.length} file${s} uploaded`);
	core.debug(`Root artifact directory is ${searchResult.rootDirectory}`);

	const key = buildCacheKey(runId, runAttempt, inputs.name);
	const stagingAbs = path.join(workspace, PAYLOAD_DIR);
	try {
		// A crashed earlier invocation may have left staging behind.
		fs.rmSync(stagingAbs, {recursive: true, force: true});

		const rootAbs = path.resolve(searchResult.rootDirectory);
		const relPaths: string[] = [];
		let totalBytes = 0;
		for (const file of searchResult.filesToUpload) {
			const rel = path.relative(rootAbs, file);
			validateFilePath(rel);
			relPaths.push(rel);
			totalBytes += (await fs.promises.stat(file)).size;
		}

		const meta: ArtifactMeta = {
			formatVersion: 1,
			name: inputs.name,
			runId,
			runAttempt,
			fileCount: relPaths.length,
			totalBytes,
			createdAt: new Date().toISOString(),
			repo
		};
		const payloadAbs = buildPayloadTar(stagingAbs, rootAbs, relPaths, meta);
		const digest = await sha256File(payloadAbs);
		const tarBytes = (await fs.promises.stat(payloadAbs)).size;
		core.info(
			`Payload built: ${relPaths.length} file${s} (${formatBytes(totalBytes)}) rooted at ${rootAbs}; tar is ${formatBytes(tarBytes)}, sha256 ${digest}`
		);

		if (inputs.overwrite) {
			await deleteExistingEntry(repo, key, inputs.token);
		}

		let cacheId = -1;
		let rawError = 'saveCache returned -1 (the backend or client refused the save without throwing)';
		try {
			cacheId = await cache.saveCache([PAYLOAD_PATH], key);
		} catch (err) {
			rawError = err instanceof Error ? err.message : String(err);
		}

		if (cacheId === -1) {
			// NEVER a silent -1: list the exact key and name the likely cause.
			let entriesForKey: CacheEntry[] | undefined;
			try {
				const list = await ghRest(
					'GET',
					`/repos/${repo}/actions/caches?key=${encodeURIComponent(key)}&per_page=100`,
					inputs.token
				);
				if (list.status === 200) {
					entriesForKey = parseCacheList(list.body);
				} else {
					core.info(`Cache listing for the failure diagnosis is unavailable (HTTP ${list.status})`);
				}
			} catch (err) {
				core.info(
					`Cache listing for the failure diagnosis is unavailable: ${err instanceof Error ? err.message : String(err)}`
				);
			}
			core.setFailed(
				chooseSaveFailureDiagnosis({name: inputs.name, key, entriesForKey, cacheMode, eventName, rawError})
			);
			return;
		}

		core.info(`Cache-backed artifact "${inputs.name}" saved: cache id ${cacheId}, key ${key}`);

		// Best-effort usage report; a failure here never fails the step.
		try {
			const usageRes = await ghRest('GET', `/repos/${repo}/actions/cache/usage`, inputs.token);
			const usage = usageRes.status === 200 ? parseCacheUsage(usageRes.body) : undefined;
			if (usage) {
				core.info(
					`Repo cache now ${formatGB(usage.active_caches_size_in_bytes)} of the ~10 GB cap (${usage.active_caches_count} entries)`
				);
			} else {
				core.info(
					`Cache usage not reported (HTTP ${usageRes.status}); grant the token actions: read for usage reporting.`
				);
			}
		} catch (err) {
			core.info(
				`Cache usage not reported (${err instanceof Error ? err.message : String(err)}); grant the token actions: read for usage reporting.`
			);
		}

		core.setOutput('artifact-id', cacheId > 0 ? String(cacheId) : '');
		core.setOutput('artifact-url', '');
		core.setOutput('artifact-digest', digest);
		core.setOutput('artifact-key', key);
	} finally {
		// The staging dir must never pollute the workspace, success or failure.
		fs.rmSync(stagingAbs, {recursive: true, force: true});
	}
}

run().catch((error) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
