// Repositories on disk for the tests to check out.

import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Repositories on disk for the tests to check out.

export function sh(args: string[], cwd: string): string {
	return execFileSync('git', args, {cwd, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}});
}

// origin makes a repository that serves single commits by id, as GitHub does.
// Files under `lfs` are committed through git-lfs, which keeps their objects in
// the repository's own LFS storage.
export function origin(root: string, name: string, files: Record<string, string>, lfs: Record<string, string> = {}): string {
	const dir = path.join(root, name);
	fs.mkdirSync(dir, {recursive: true});
	sh(['init', '--quiet', '--initial-branch=main'], dir);
	sh(['config', 'uploadpack.allowAnySHA1InWant', 'true'], dir);
	const all: Record<string, string> = {...files, ...lfs};
	if (Object.keys(lfs).length > 0) {
		sh(['lfs', 'install', '--local'], dir);
		all['.gitattributes'] = Object.keys(lfs)
			.map(file => `${file} filter=lfs diff=lfs merge=lfs -text\n`)
			.join('');
	}
	for (const [file, text] of Object.entries(all)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
		fs.writeFileSync(path.join(dir, file), text);
	}
	sh(['add', '-A'], dir);
	sh(['commit', '--quiet', '-m', 'init'], dir);
	return dir;
}

// link adds a gitlink at `at` pointing at the head of `child`, under a relative url.
export function link(superDir: string, child: string, at: string, name: string): void {
	sh(['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', '--name', name, `../${path.basename(child)}`, at], superDir);
	sh(['commit', '--quiet', '-m', `add ${at}`], superDir);
}

export function head(dir: string): string {
	return sh(['rev-parse', 'HEAD'], dir).trim();
}

// advance commits a new file on `branch` of an origin, creating the branch if needed, and returns the new head.
export function advance(dir: string, branch: string, file: string): string {
	sh(['checkout', '--quiet', '-B', branch], dir);
	fs.writeFileSync(path.join(dir, file), `${file}\n`);
	sh(['add', '-A'], dir);
	sh(['commit', '--quiet', '-m', `advance ${branch}`], dir);
	return head(dir);
}
