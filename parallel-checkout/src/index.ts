import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {headLister, readTree} from './api';
import {Checkout, Refill, Submodules, refillNow, refillVariable} from './checkout';
import {Git, Pool} from './git';
import {basicAuth, pickRef, planRef} from './plan';
import {lockName, runLock} from './runlock';

function submodulesInput(value: string): Submodules {
	const lower = value.trim().toLowerCase();
	if (lower === 'recursive' || lower === 'true' || lower === 'false') {
		return lower;
	}
	throw new Error(`submodules must be false, true or recursive, not "${value}"`);
}

function intInput(name: string, min: number): number {
	const raw = core.getInput(name).trim();
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min) {
		throw new Error(`${name} must be an integer of at least ${min}, not "${raw}"`);
	}
	return value;
}

async function emptyDir(dir: string): Promise<void> {
	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch (error) {
		if ((error as {code?: string}).code === 'ENOENT') {
			return;
		}
		throw error;
	}
	await Promise.all(entries.map(entry => fsp.rm(path.join(dir, entry), {recursive: true, force: true})));
}

// resolveRef turns the ref input, or the event's ref, into a full ref name
// plus the commit the event pinned. That resolveRef is with one round trip
// for a bare name.
async function resolveRef(git: Git, url: string, repository: string): Promise<{ref: string; sha: string}> {
	let ref = core.getInput('ref').trim();
	let sha = '';
	if (ref === '') {
		if (repository === process.env.GITHUB_REPOSITORY) {
			ref = process.env.GITHUB_REF || '';
			sha = process.env.GITHUB_SHA || '';
		} else {
			ref = 'HEAD';
		}
	}
	if (ref === 'HEAD') {
		const listing = await git.must(['ls-remote', '--symref', url, 'HEAD']);
		const symref = /^ref: (refs\/heads\/\S+)\tHEAD$/m.exec(listing);
		if (symref === null) {
			throw new Error(`cannot read the default branch of ${url}: ${listing.trim()}`);
		}
		ref = symref[1];
	} else if (!ref.startsWith('refs/') && !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(ref)) {
		ref = pickRef(ref, await git.must(['ls-remote', url, `refs/heads/${ref}`, `refs/tags/${ref}`]));
	}
	return {ref, sha};
}

async function run(): Promise<void> {
	const started = Date.now();
	const workspace = process.env.GITHUB_WORKSPACE;
	if (workspace === undefined || workspace === '') {
		throw new Error('GITHUB_WORKSPACE is not set');
	}
	const server = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
	const repository = core.getInput('repository').trim() || process.env.GITHUB_REPOSITORY || '';
	if (repository === '') {
		throw new Error('no repository: the repository input and GITHUB_REPOSITORY are both empty');
	}
	const url = `${server}/${repository}`;
	const dir = path.resolve(workspace, core.getInput('path').trim() || '.');
	if (!dir.startsWith(workspace)) {
		throw new Error(`path ${dir} is outside the workspace ${workspace}`);
	}
	const token = core.getInput('token').trim();
	const submodules = submodulesInput(core.getInput('submodules'));
	const depth = intInput('fetch-depth', 0);
	const jobs = intInput('jobs', 1);
	const persist = core.getBooleanInput('persist-credentials');
	const clean = core.getBooleanInput('clean');
	const workers = os.availableParallelism();

	// The credential rides on every call, and into each repo's config only when the caller wants later steps to have it.
	const configArgs: string[] = ['-c', 'init.defaultBranch=main', '-c', 'protocol.version=2'];
	const config: Array<[string, string]> = [];
	if (token !== '') {
		const auth = basicAuth(token);
		core.setSecret(auth);
		const host = new URL(server).host;
		const settings: Array<[string, string]> = [
			[`http.${server}/.extraheader`, `AUTHORIZATION: basic ${auth}`],
			[`url.${server}/.insteadOf`, `git@${host}:`],
			[`url.${server}/.insteadOf`, `ssh://git@${host}/`],
		];
		// On the command line for every call, so an ls-remote outside any
		// repository is authenticated too.
		for (const [key, value] of settings) {
			configArgs.push('-c', `${key}=${value}`);
		}
		if (persist) {
			config.push(...settings);
		}
	}
	// A directory in no repository, for the calls made before the checkout exists.
	const home = await fsp.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'parallel-checkout-'));
	const git = new Git(new Pool(jobs), configArgs, home);

	const {ref, sha} = await resolveRef(git, url, repository);
	const plan = planRef(ref, sha);
	core.info(`checking out ${url} at ${ref}${sha === '' ? '' : ` (${sha})`} into ${dir} with up to ${jobs} git processes and ${workers} checkout workers`);

	if (clean) {
		await emptyDir(dir);
	}
	// The runner may own the directory under another uid than the git runs as.
	await git.must(['config', '--global', '--add', 'safe.directory', dir]);

	const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
	const rootTree = () => readTree({git, apiUrl, repository, token, url, ref, sha, log: core.info});
	const branch = core.getInput('submodule-branch').trim();
	const scope = core
		.getInput('submodule-branch-scope')
		.split('\n')
		.map(prefix => prefix.trim())
		.filter(prefix => prefix !== '');
	const follow = branch === '' ? undefined : {branch, scope: scope.length > 0 ? scope : [`${server}/${repository.split('/')[0]}/`]};
	if (follow !== undefined) {
		core.info(`direct submodules under ${follow.scope.join(', ')} follow ${follow.branch}, their .gitmodules branch, or their default branch`);
	}
	const store = core.getInput('submodule-branch-lock').trim();
	let lockHead: ((url: string, branch: string, head: string) => Promise<string>) | undefined;
	if (store !== '') {
		if (follow === undefined) {
			throw new Error('submodule-branch-lock needs submodule-branch: only a followed submodule takes a locked head');
		}
		const lock = runLock({
			store,
			run: {repository: process.env.GITHUB_REPOSITORY || '', runId: process.env.GITHUB_RUN_ID || '', runAttempt: process.env.GITHUB_RUN_ATTEMPT || ''},
			token: audience => core.getIDToken(audience),
			fetch: (target, init) => fetch(target, init),
			log: core.warning,
		});
		lockHead = (submoduleUrl, followBranch, head) => lock(lockName(submoduleUrl, followBranch), head);
		core.info(`followed heads are locked for this run attempt in ${store}`);
	}
	const toolCache = process.env.RUNNER_TOOL_CACHE || '';
	const objects = core.getInput('store').trim() || (toolCache === '' ? '' : path.join(toolCache, 'parallel-checkout'));
	if (objects === '') {
		core.warning('no object store: the store input and RUNNER_TOOL_CACHE are both empty, so every repository is fetched in full');
	}
	let listHeads: ((url: string, refs: string[]) => Promise<string | undefined>) | undefined;
	if (follow !== undefined && token !== '') {
		listHeads = headLister({apiUrl, server, token, log: core.info});
		// The head lookup comes after the tree is read, by then over a connection this opened.
		fetch(apiUrl, {method: 'HEAD'}).catch(() => undefined);
	}
	const checkout = new Checkout({git, dir, url, plan, depth, submodules, workers, config, rootTree, follow, lockHead, listHeads, store: objects, log: core.info});
	const {commit, repos} = await checkout.run();
	core.setOutput('commit', commit);
	core.setOutput('ref', ref);
	core.info(`${repos} repositor${repos === 1 ? 'y' : 'ies'} checked out in ${Date.now() - started}ms`);
	const compacting = Date.now();
	const added = await checkout.compact();
	core.setOutput('store-added', String(added));
	core.info(`the store gained ${added} entr${added === 1 ? 'y' : 'ies'}, and is ready for the next checkout ${Date.now() - compacting}ms later`);
}

if (process.env[refillVariable] === '1') {
	refillNow(Number(process.argv[2]), JSON.parse(process.argv[3]) as Refill[]);
} else {
	run().catch((error: unknown) => {
		core.setFailed(error instanceof Error ? error.message : String(error));
	});
}
