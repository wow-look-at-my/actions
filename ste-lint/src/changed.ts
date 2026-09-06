// This action lints what a push changed, not what the repository contains.
//
// A whole-tree lint asks a repository to answer for prose it did not write in
// this change, and for prose it may not have written at all. A fork carries its
// upstream's documentation. An imported tree carries somebody else's. Neither
// belongs to the person whose commit turned the check red, and a check that
// nobody can turn green is a check people route around.
//
// So the scope is the diff. A file this push did not touch is out of scope even
// when it has findings, and the same file comes into scope the moment somebody
// edits it. The rule that reaches the author is the rule the author can obey.

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

export type Event = {
	name: string;
	payload: unknown;
};

export type Scope = {
	// The files the event changed, or null when the base is unknown.
	files: string[] | null;
	// What this run scoped to, or why it could not.
	note: string;
};

type Git = (args: string[]) => string;

function field(value: unknown, ...path: string[]): string | null {
	let node: unknown = value;
	for (const key of path) {
		if (node === null || typeof node !== 'object') return null;
		node = (node as Record<string, unknown>)[key];
	}
	return typeof node === 'string' && node !== '' ? node : null;
}

// A commit of all zeros is git's way of saying "there was nothing here before":
// the first push of a branch, or a branch that was just created.
function real(sha: string | null): string | null {
	return sha !== null && !/^0+$/.test(sha) ? sha : null;
}

// Names the commit this event's diff starts from. A pull request measures
// against the branch it merges into. A push measures against the branch tip it
// replaced, and a brand new branch has no such tip, so it measures against the
// default branch instead.
export function baseOf(event: Event): string | null {
	const {name, payload} = event;
	if (name === 'pull_request' || name === 'pull_request_target') {
		return real(field(payload, 'pull_request', 'base', 'sha'));
	}
	const before = real(field(payload, 'before'));
	if (before !== null) return before;
	const branch = field(payload, 'repository', 'default_branch');
	return branch === null ? null : `refs/heads/${branch}`;
}

// Lists the files between the base and HEAD.
//
// `git diff` compares two trees and never needs a common ancestor, so a
// depth-1 checkout works once the base commit itself is present. That is what
// the fetch is for: actions/checkout takes one commit by default, and the base
// is not it.
export function changedFiles(base: string, git: Git = runGit): string[] {
	let rev = base;
	if (base.startsWith('refs/')) {
		git(['fetch', '--no-tags', '--depth=1', 'origin', base]);
		rev = 'FETCH_HEAD';
	} else {
		try {
			git(['cat-file', '-e', `${base}^{commit}`]);
		} catch {
			git(['fetch', '--no-tags', '--depth=1', 'origin', base]);
		}
	}
	const out = git(['diff', '--name-only', '-z', '--diff-filter=ACMRT', rev, 'HEAD']);
	return out.split('\0').filter((name) => name !== '');
}

// Resolves the scope for this run. A failure here returns null files, and the
// caller then lints everything and says so: this decides what to SKIP, and a
// check that skips on an error is a check that passes for the wrong reason.
export function scopeOf(event: Event, git: Git = runGit): Scope {
	const base = baseOf(event);
	if (base === null) {
		return {files: null, note: `ste-lint: the ${event.name} event names no base commit, so this run reads the whole tree`};
	}
	try {
		return {files: changedFiles(base, git), note: `ste-lint: scoped to what changed since ${base}`};
	} catch (err) {
		const why = err instanceof Error ? err.message : String(err);
		return {files: null, note: `ste-lint: could not diff against ${base} (${why}), so this run reads the whole tree`};
	}
}

// Reads the event this run was started by. An unreadable payload is not an
// error: it leaves the base unknown, which widens the scope rather than
// narrowing it.
export function currentEvent(): Event {
	const name = process.env.GITHUB_EVENT_NAME ?? '';
	const path = process.env.GITHUB_EVENT_PATH;
	if (path === undefined || path === '') return {name, payload: null};
	try {
		return {name, payload: JSON.parse(readFileSync(path, 'utf-8'))};
	} catch {
		return {name, payload: null};
	}
}

function runGit(args: string[]): string {
	return execFileSync('git', args, {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']});
}
