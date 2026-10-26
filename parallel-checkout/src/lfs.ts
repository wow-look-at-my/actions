// LfsFile is one line of `git lfs ls-files --long`: the object id, whether the worktree file holds the object's content (`*`) or its pointer.

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {Git} from './git';

// LfsFile is one line of `git lfs ls-files --long`: the object id, whether the worktree file holds the object's content (`*`) or its pointer.
export type LfsFile = {oid: string; present: boolean; path: string};

export function parseLsFiles(text: string): LfsFile[] {
	const out: LfsFile[] = [];
	for (const line of text.split('\n')) {
		const match = /^([0-9a-f]{64}) ([*-]) (.+)$/.exec(line.replace(/\r$/, ''));
		if (match !== null) {
			out.push({oid: match[1], present: match[2] === '*', path: match[3]});
		}
	}
	return out;
}

// objectPath is where git-lfs keeps an object under a storage directory.
export function objectPath(storage: string, oid: string): string {
	return path.join(storage, 'objects', oid.slice(0, 2), oid.slice(2, 4), oid);
}

// lfsVersion fails loudly when git-lfs is missing, before any repository is touched.
export async function lfsVersion(git: Git): Promise<string> {
	const result = await git.run(['lfs', 'version']);
	if (result.code !== 0) {
		throw new Error(`lfs is true but git-lfs is not installed: git lfs version exited ${result.code}: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

export type LfsRepo = {
	git: Git;
	// The worktree and the git directory of the repository.
	dir: string;
	gitdir: string;
	label: string;
	// The commit the worktree is checked out at.
	commit: string;
	// Where git-lfs keeps the objects, such as a directory in the store. Undefined keeps them in the git directory.
	storage?: string;
	// Installs git-lfs into a repository whose tree holds no LFS file, as actions/checkout does for the superproject.
	always: boolean;
	// Settles once the worktree and index are at the commit.
	written: Promise<void>;
	// locked runs a task while no other writer touches the repository's config.
	locked: (task: () => Promise<void>) => Promise<void>;
	log: (message: string) => void;
};

export type LfsResult = {files: number; added: boolean};

// takeLfs puts the content of every LFS file of the commit into the
// worktree. The objects download while git writes the worktree, and only
// those the storage lacks are fetched. The filter config lands before the
// pointers are replaced, so git reads every replaced file as unchanged. A file
// that still holds its pointer afterwards fails the checkout.
export async function takeLfs(repo: LfsRepo): Promise<LfsResult> {
	const git = repo.git;
	const files = parseLsFiles(await git.must(['lfs', 'ls-files', '--long', repo.commit], repo.dir));
	if (files.length === 0 && !repo.always) {
		await repo.written;
		return {files: 0, added: false};
	}
	const storage = repo.storage ?? path.join(repo.gitdir, 'lfs');
	// The storage goes in the local config: a `-c` reaches every git-lfs the fetch runs, the one reading a file remote included.
	const stored = repo.storage;
	if (stored !== undefined) {
		await repo.locked(async () => {
			await git.must(['config', '--local', 'lfs.storage', stored], repo.dir);
		});
	}
	const installed = repo.locked(async () => {
		await git.must(['lfs', 'install', '--local'], repo.dir);
	});
	const missing = files.filter(file => !fs.existsSync(objectPath(storage, file.oid)));
	const fetching = missing.length === 0 ? Promise.resolve('') : git.must(['lfs', 'fetch', 'origin', repo.commit], repo.dir);
	await Promise.all([installed, fetching, repo.written]);
	if (files.length === 0) {
		return {files: 0, added: false};
	}
	await git.must(['lfs', 'checkout'], repo.dir, {GIT_LFS_SKIP_SMUDGE: '0'});
	const pointers = parseLsFiles(await git.must(['lfs', 'ls-files', '--long'], repo.dir)).filter(file => !file.present);
	if (pointers.length > 0) {
		throw new Error(`${repo.label}: git lfs checkout left pointer files in place of their content: ${pointers.map(file => file.path).join(', ')}`);
	}
	repo.log(`${repo.label}: ${files.length} LFS file(s) checked out, ${missing.length} of them fetched`);
	return {files: files.length, added: repo.storage !== undefined && missing.length > 0};
}

// writeStored writes the commit's worktree out of a store repository into
// `target`, every LFS file as its pointer, through a scratch index.
export async function writeStored(git: Git, store: string, commit: string, target: string, workers: number): Promise<void> {
	const index = `${target}.index`;
	const env = {GIT_INDEX_FILE: index};
	await fsp.mkdir(target);
	try {
		await git.must(['--git-dir', store, 'read-tree', commit], undefined, env);
		await git.must(['--git-dir', store, '--work-tree', target, '-c', `checkout.workers=${workers}`, 'checkout-index', '-a', '-f'], undefined, env);
	} finally {
		await fsp.rm(index, {force: true});
	}
}
