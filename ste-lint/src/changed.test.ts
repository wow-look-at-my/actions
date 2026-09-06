import assert from 'node:assert/strict';
import {test} from 'node:test';
import {baseOf, changedFiles, scopeOf} from './changed';

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

test('the diff names the files, and an absent base commit is fetched first', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		if (args[0] === 'cat-file') throw new Error('not our ref');
		if (args[0] === 'diff') return 'README.md\0docs/one.md\0';
		return '';
	};
	assert.deepEqual(changedFiles('def456', git), ['README.md', 'docs/one.md']);
	assert.deepEqual(calls[0], ['cat-file', '-e', 'def456^{commit}']);
	assert.deepEqual(calls[1], ['fetch', '--no-tags', '--depth=1', 'origin', 'def456']);
	assert.equal(calls[2][0], 'diff');
});

test('a base commit already in the checkout is not fetched again', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		return args[0] === 'diff' ? 'README.md\0' : '';
	};
	assert.deepEqual(changedFiles('def456', git), ['README.md']);
	assert.deepEqual(
		calls.map((c) => c[0]),
		['cat-file', 'diff'],
	);
});

test('a branch base is fetched and read back as FETCH_HEAD', () => {
	const calls: string[][] = [];
	const git = (args: string[]): string => {
		calls.push(args);
		return args[0] === 'diff' ? '' : '';
	};
	changedFiles('refs/heads/master', git);
	assert.deepEqual(calls[0], ['fetch', '--no-tags', '--depth=1', 'origin', 'refs/heads/master']);
	assert.equal(calls[1].at(-2), 'FETCH_HEAD');
});

test('a push that changed nothing scopes to nothing, which is not the same as unknown', () => {
	const git = (args: string[]): string => (args[0] === 'diff' ? '' : '');
	const scope = scopeOf({name: 'push', payload: {before: 'def456'}}, git);
	assert.deepEqual(scope.files, []);
});

test('a git failure widens the scope rather than narrowing it', () => {
	const git = (): string => {
		throw new Error('fatal: bad object');
	};
	const scope = scopeOf({name: 'push', payload: {before: 'def456'}}, git);
	assert.equal(scope.files, null);
	assert.match(scope.note, /whole tree/);
});

test('an event with no base widens the scope too', () => {
	const scope = scopeOf({name: 'schedule', payload: {}}, () => '');
	assert.equal(scope.files, null);
	assert.match(scope.note, /whole tree/);
});
