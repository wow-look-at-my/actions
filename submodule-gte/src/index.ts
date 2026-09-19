import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {Ancestry, Entry, ancestryOf, gitlinks, judge, paths, short} from './compare';

// A submodule gitlink may move forward, and a build moves it there on its own.
// It may not move back. see README.md

type Run = {code: number; stdout: string; stderr: string};

function splitList(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map(entry => entry.trim())
		.filter(entry => entry !== '');
}

async function git(args: string[], cwd?: string): Promise<Run> {
	let stdout = '';
	let stderr = '';
	const code = await exec.exec('git', args, {
		cwd,
		ignoreReturnCode: true,
		silent: true,
		listeners: {
			stdout: (data: Buffer) => {
				stdout += data.toString();
			},
			stderr: (data: Buffer) => {
				stderr += data.toString();
			},
		},
	});
	return {code, stdout, stderr};
}

async function isDir(target: string): Promise<boolean> {
	try {
		return (await fsp.stat(target)).isDirectory();
	} catch {
		return false;
	}
}

// resolveBase answers the ref this branch is measured against. A pull request
// carries it. Anything else has to name it, because guessing the branch a push
// will merge into would compare against a ref nobody chose.
function resolveBase(): string {
	const given = core.getInput('base').trim();
	if (given !== '') {
		return given;
	}
	const fromEvent = (process.env.GITHUB_BASE_REF || '').trim();
	if (fromEvent !== '') {
		return fromEvent;
	}
	throw new Error(
		'no base ref: this is not a pull request, so name one with the `base` input (the branch this one is measured against)',
	);
}

// fetchBase brings the base ref into this checkout. A checkout of one branch
// carries no other, and `git fetch --depth=1` is enough to read a tree.
async function fetchBase(base: string): Promise<string> {
	const local = `refs/remotes/origin/${base}`;
	const already = await git(['rev-parse', '--verify', '--quiet', `${local}^{commit}`]);
	if (already.code === 0) {
		return local;
	}
	const fetched = await git(['fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${base}:${local}`]);
	if (fetched.code !== 0) {
		throw new Error(`cannot fetch the base ref ${base}: ${fetched.stderr.trim()}`);
	}
	return local;
}

async function linksAt(rev: string): Promise<Map<string, string>> {
	const listed = await git(['ls-tree', '-r', rev]);
	if (listed.code !== 0) {
		throw new Error(`cannot read the tree at ${rev}: ${listed.stderr.trim()}`);
	}
	return gitlinks(listed.stdout);
}

async function has(dir: string, sha: string): Promise<boolean> {
	return (await git(['cat-file', '-e', `${sha}^{commit}`], dir)).code === 0;
}

// reachable brings both commits into the submodule's own object database, which
// is what answers the ancestry question. A checkout takes the submodule at one
// commit, so the other one is usually absent.
async function reachable(dir: string, base: string, head: string): Promise<boolean> {
	if ((await has(dir, base)) && (await has(dir, head))) {
		return true;
	}
	// A server that serves a bare commit answers this in one round trip.
	for (const sha of [base, head]) {
		if (!(await has(dir, sha))) {
			await git(['fetch', '--no-tags', 'origin', sha], dir);
		}
	}
	if ((await has(dir, base)) && (await has(dir, head))) {
		return true;
	}
	// Otherwise take every branch, which any server serves.
	await git(['fetch', '--no-tags', 'origin', '+refs/heads/*:refs/remotes/origin/*'], dir);
	return (await has(dir, base)) && (await has(dir, head));
}

async function ancestryIn(dir: string, base: string, head: string): Promise<Ancestry | undefined> {
	if (!(await isDir(path.join(dir, '.git'))) && !(await isDir(dir))) {
		return undefined;
	}
	if (!(await reachable(dir, base, head))) {
		return undefined;
	}
	const baseInHead = (await git(['merge-base', '--is-ancestor', base, head], dir)).code === 0;
	const headInBase = (await git(['merge-base', '--is-ancestor', head, base], dir)).code === 0;
	return ancestryOf(baseInHead, headInBase);
}

async function run(): Promise<void> {
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	process.chdir(workspace);

	const only = new Set(splitList(core.getInput('paths')));
	const skip = new Set(splitList(core.getInput('exclude')));

	const base = resolveBase();
	const baseRef = await fetchBase(base);
	core.info(`measuring against ${base} (${short((await git(['rev-parse', baseRef])).stdout.trim())})`);

	const atBase = await linksAt(baseRef);
	const atHead = await linksAt('HEAD');

	const verdicts = [];
	for (const submodule of paths(atBase, atHead)) {
		if (skip.has(submodule) || (only.size > 0 && !only.has(submodule))) {
			core.info(`${submodule}: not checked`);
			continue;
		}
		const entry: Entry = {path: submodule, base: atBase.get(submodule), head: atHead.get(submodule)};
		let ancestry: Ancestry | undefined;
		if (entry.base !== undefined && entry.head !== undefined && entry.base !== entry.head) {
			ancestry = await ancestryIn(path.join(workspace, submodule), entry.base, entry.head);
		}
		verdicts.push(judge(entry, ancestry));
	}

	if (verdicts.length === 0) {
		// A repo that asks for this check has submodules. None found means the
		// workspace is not that repo, which is a missing checkout.
		core.warning(
			`no submodule under ${workspace}, at ${base} or at HEAD, so this run checked nothing. Check the repo out first, with submodules.`,
		);
		return;
	}

	const failed = verdicts.filter(verdict => !verdict.ok);
	for (const verdict of verdicts) {
		if (verdict.ok) {
			core.info(verdict.message);
		} else {
			core.error(verdict.message);
		}
	}
	if (failed.length > 0) {
		core.setFailed(
			`${failed.length} of ${verdicts.length} submodule(s) do not carry what ${base} carries. A gitlink may move forward; it may not move back.`,
		);
	}
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
