import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {baseOf, changedLines, parseHunks, scopeOf} from './changed';
import {onTouched, parseReport} from './slopfix';
import {vendoredPaths} from './vendored';

const ZERO = '0000000000000000000000000000000000000000';

test('a pull request measures against the branch it merges into', () => {
	assert.equal(baseOf({name: 'pull_request', payload: {pull_request: {base: {sha: 'abc123'}}}}), 'abc123');
	assert.equal(baseOf({name: 'pull_request_target', payload: {pull_request: {base: {sha: 'abc123'}}}}), 'abc123');
});

test('a push measures against the tip it replaced', () => {
	assert.equal(baseOf({name: 'push', payload: {before: 'def456', repository: {default_branch: 'master'}}}), 'def456');
});

test("a new branch has no tip to replace, so it measures against the default branch", () => {
	assert.equal(baseOf({name: 'push', payload: {before: ZERO, repository: {default_branch: 'master'}}}), 'refs/heads/master');
});

test('an event that names neither leaves the base unknown', () => {
	assert.equal(baseOf({name: 'workflow_dispatch', payload: {}}), null);
	assert.equal(baseOf({name: 'push', payload: null}), null);
	assert.equal(baseOf({name: 'pull_request', payload: {pull_request: {}}}), null);
});

const DIFF = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -4,0 +5,2 @@ intro
+a new line
+and another
@@ -20 +21 @@
+a rewritten line
diff --git a/docs/gone.md b/docs/gone.md
--- a/docs/gone.md
+++ /dev/null
@@ -1,3 +0,0 @@
`;

test('a hunk names the lines the file now has, and a deletion names none', () => {
	const touched = parseHunks(DIFF);
	assert.deepEqual([...touched.keys()], ['README.md']);
	assert.deepEqual([...touched.get('README.md')!].sort((a, b) => a - b), [5, 6, 21]);
});

test('a hunk with no count covers exactly one line', () => {
	const touched = parseHunks('+++ b/a.md\n@@ -9 +9 @@\n+one\n');
	assert.deepEqual([...touched.get('a.md')!], [9]);
});

test('the diff names the lines, and an absent base commit is fetched first', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		if (args[0] === 'cat-file') throw new Error('not our ref');
		return args[0] === 'diff' ? DIFF : '';
	};
	assert.deepEqual([...changedLines('def456', git).keys()], ['README.md']);
	assert.deepEqual(calls[0], ['cat-file', '-e', 'def456^{commit}']);
	assert.deepEqual(calls[1], ['fetch', '--no-tags', '--depth=1', 'origin', 'def456']);
	assert.equal(calls[2][0], 'diff');
	assert.ok(calls[2].includes('--unified=0'), 'the diff must carry no context, or an untouched line reads as changed');
});

test('a base commit already in the checkout is not fetched again', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		return args[0] === 'diff' ? DIFF : '';
	};
	changedLines('def456', git);
	assert.deepEqual(
		calls.map((c) => c[0]),
		['cat-file', 'diff'],
	);
});

// slopfix places a finding on the first line of its paragraph, so a change to any line of it counts.
test('a finding stays when the change touched any line of its paragraph', () => {
	const lines = ['# T', '', 'The first line', 'wraps here; and goes on.', '', 'Another paragraph.'];
	const findings = [
		{id: 'ste/semicolon', line: 3, rule: 'STE bans the semicolon'},
		{id: 'ste/contraction', line: 6, rule: 'STE bans contractions'},
	];
	assert.deepEqual(onTouched(findings, lines, new Set([4])).map((f) => f.id), ['ste/semicolon']);
	assert.deepEqual(onTouched(findings, lines, new Set([6])).map((f) => f.id), ['ste/contraction']);
	assert.deepEqual(onTouched(findings, lines, new Set([2, 5])), []);
});

test('the report parser reads findings, and a report with none is empty', () => {
	const out = '{"path":"a.md","findings":[{"id":"wrap/hard-wrap","line":3,"endLine":3,"rule":"a paragraph is one line"}]}';
	assert.equal(parseReport(out)[0].id, 'wrap/hard-wrap');
	assert.deepEqual(parseReport('{"path":"a.md","findings":null}'), []);
});

test('a branch base is fetched and read back as FETCH_HEAD', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		return '';
	};
	changedLines('refs/heads/master', git);
	assert.deepEqual(calls[0], ['fetch', '--no-tags', '--depth=1', 'origin', 'refs/heads/master']);
	assert.equal(calls[1].at(-2), 'FETCH_HEAD');
});

test('a push that changed nothing scopes to nothing, which is not the same as unknown', () => {
	const scope = scopeOf({name: 'push', payload: {before: 'def456'}}, () => '');
	assert.equal(scope.touched?.size, 0);
});

test('a git failure widens the scope rather than narrowing it', () => {
	const git = (): string => {
		throw new Error('fatal: bad object');
	};
	const scope = scopeOf({name: 'push', payload: {before: 'def456'}}, git);
	assert.equal(scope.touched, null);
	assert.match(scope.note, /whole tree/);
});

test('an event with no base widens the scope too', () => {
	const scope = scopeOf({name: 'schedule', payload: {}}, () => '');
	assert.equal(scope.touched, null);
	assert.match(scope.note, /whole tree/);
});

test('a diff past the 1 MiB default buffer is read, not reported as an unreachable base', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ste-lint-'));
	const git = (args: string[]): string => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf-8', maxBuffer: Infinity});
	git(['init', '--quiet']);
	git(['config', 'user.email', 'test@example.com']);
	git(['config', 'user.name', 'test']);
	writeFileSync(join(dir, 'README.md'), 'intro\n');
	git(['add', '-A']);
	git(['commit', '--quiet', '-m', 'base']);
	const base = git(['rev-parse', 'HEAD']).trim();

	const big = Array.from({length: 60000}, (_, i) => `line ${i} of a change that runs past a megabyte`).join('\n');
	writeFileSync(join(dir, 'big.md'), `${big}\n`);
	git(['add', '-A']);
	git(['commit', '--quiet', '-m', 'big']);
	assert.ok(git(['diff', '--unified=0', base, 'HEAD']).length > 1024 * 1024);

	const cwd = process.cwd();
	process.chdir(dir);
	try {
		const scope = scopeOf({name: 'push', payload: {before: base}});
		assert.equal(scope.touched?.get('big.md')?.size, 60000);
		assert.match(scope.note, /scoped to/);
	} finally {
		process.chdir(cwd);
		rmSync(dir, {recursive: true, force: true});
	}
});

// GIT_TEST_ASSUME_DIFFERENT_OWNER makes git refuse the checkout, as a container job does.
test('a checkout owned by another user still scopes to the diff and reads its attributes', () => {
	const dir = mkdtempSync(join(tmpdir(), 'ste-lint-'));
	const git = (args: string[]): string => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf-8'});
	git(['init', '--quiet']);
	git(['config', 'user.email', 'test@example.com']);
	git(['config', 'user.name', 'test']);
	writeFileSync(join(dir, 'README.md'), 'intro\n');
	writeFileSync(join(dir, '.gitattributes'), 'vendor/** linguist-vendored\n');
	git(['add', '-A']);
	git(['commit', '--quiet', '-m', 'base']);
	const base = git(['rev-parse', 'HEAD']).trim();
	writeFileSync(join(dir, 'README.md'), 'intro\nmore\n');
	git(['commit', '--quiet', '-am', 'edit']);

	const cwd = process.cwd();
	process.chdir(dir);
	// A runner's own config can trust every directory, which would hide the refusal.
	const isolated = {GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
	Object.assign(process.env, isolated);
	try {
		assert.throws(() => execFileSync('git', ['status'], {stdio: 'pipe'}), /dubious ownership/);
		const scope = scopeOf({name: 'push', payload: {before: base}});
		assert.match(scope.note, /scoped to/);
		assert.deepEqual([...(scope.touched?.get('README.md') ?? [])], [2]);
		assert.deepEqual([...vendoredPaths(['vendor/a.md', 'README.md'])], ['vendor/a.md']);
	} finally {
		for (const key of Object.keys(isolated)) delete process.env[key];
		process.chdir(cwd);
		rmSync(dir, {recursive: true, force: true});
	}
});
