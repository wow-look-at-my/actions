import * as core from '@actions/core';
import * as github from '@actions/github';
import {isAgedOut, isRunEntry, listPrefix, parseMaxAge} from './lib';

// The cache service has no per-entry TTL, so short hand-off lifetime is done
// by explicit deletion through the DOCUMENTED public REST API (unlike the
// upload/download pair, nothing internal is touched here):
//   - GET    /repos/{owner}/{repo}/actions/caches
//       `key` is "An explicit key or prefix for identifying the cache";
//       entries carry id, key, ref, last_accessed_at, created_at,
//       size_in_bytes.
//   - DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}
// (https://docs.github.com/en/rest/actions/cache — octokit methods
// actions.getActionsCacheList / actions.deleteActionsCacheById.)
// Both need a token with `actions: write` on the repository — the consumer
// job must declare that permission for github.token.

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Required environment variable ${name} is not set`);
	}
	return value;
}

async function run(): Promise<void> {
	const name = core.getInput('name') || undefined;
	if (name?.includes(',')) {
		throw new Error("The 'name' input must not contain commas");
	}
	const maxAgeInput = core.getInput('max-age') || '12h';
	const maxAgeMs = parseMaxAge(maxAgeInput);
	const token = core.getInput('github-token', {required: true});
	const runId = requireEnv('GITHUB_RUN_ID');

	const octokit = github.getOctokit(token);
	const {owner, repo} = github.context.repo;
	const prefix = listPrefix(name);

	// One paginated pass over the namespace; each entry is then judged twice:
	// belongs-to-this-run (delete, all attempts) or aged-out (sweep). The
	// sweep is what bounds leftovers from crashed/cancelled runs whose own
	// cleanup never ran; the service's 7-day-unused GC stays as the final
	// backstop.
	let caches: Array<{id?: number; key?: string; last_accessed_at?: string; created_at?: string; size_in_bytes?: number}>;
	try {
		caches = await octokit.paginate(octokit.rest.actions.getActionsCacheList, {owner, repo, key: prefix, per_page: 100});
	} catch (error) {
		throw decorate403(error, 'list');
	}
	core.info(`Found ${caches.length} cache entr${caches.length === 1 ? 'y' : 'ies'} under prefix '${prefix}'`);

	const now = Date.now();
	let deleted = 0;
	let freedBytes = 0;
	for (const entry of caches) {
		if (entry.id === undefined || !entry.key) {
			continue;
		}
		let reason: string | undefined;
		if (isRunEntry(entry.key, runId, name)) {
			reason = `belongs to this run (${runId})`;
		} else if (isAgedOut(entry.last_accessed_at, entry.created_at, now, maxAgeMs)) {
			reason = `last accessed more than ${maxAgeInput} ago`;
		}
		if (!reason) {
			continue;
		}
		try {
			await octokit.rest.actions.deleteActionsCacheById({owner, repo, cache_id: entry.id});
		} catch (error) {
			if ((error as {status?: number}).status === 404) {
				core.info(`Already gone: ${entry.key}`);
				continue;
			}
			throw decorate403(error, 'delete');
		}
		deleted++;
		freedBytes += entry.size_in_bytes ?? 0;
		core.info(`Deleted ${entry.key} — ${reason}`);
	}

	core.info(`Deleted ${deleted} hand-off cache entr${deleted === 1 ? 'y' : 'ies'} (${Math.round(freedBytes / (1024 * 1024))} MB)`);
	core.setOutput('deleted-count', String(deleted));
}

function decorate403(error: unknown, what: string): unknown {
	if ((error as {status?: number}).status === 403) {
		return new Error(`Failed to ${what} cache entries: the token lacks access. The job needs 'permissions: actions: write' for cache-cleanup. (${(error as Error).message})`);
	}
	return error;
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
