import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ancestryOf, gitlinks, judge, paths} from './compare';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

test('ls-tree names every gitlink and no ordinary file', () => {
	const lsTree = [
		'100644 blob ' + 'c'.repeat(40) + '\tgo.mod',
		'160000 commit ' + BASE + '\tsrc/cmd/vendor/example.com/one',
		'040000 tree ' + 'd'.repeat(40) + '\tsrc',
		'160000 commit ' + HEAD + '\tvendor/two',
	].join('\n');
	assert.deepEqual(
		[...gitlinks(lsTree).entries()],
		[['src/cmd/vendor/example.com/one', BASE], ['vendor/two', HEAD]],
	);
});

test('a path on either side is reported, in one order', () => {
	const base = new Map([['b', BASE], ['a', BASE]]);
	const head = new Map([['a', HEAD], ['c', HEAD]]);
	assert.deepEqual(paths(base, head), ['a', 'b', 'c']);
});

test('the two is-ancestor answers name the direction', () => {
	assert.equal(ancestryOf(true, true), 'same');
	assert.equal(ancestryOf(true, false), 'forward');
	assert.equal(ancestryOf(false, true), 'backward');
	assert.equal(ancestryOf(false, false), 'unrelated');
});

test('a gitlink that moves forward passes', () => {
	const verdict = judge({path: 'vendor/one', base: BASE, head: HEAD}, 'forward');
	assert.equal(verdict.ok, true);
});

test('a gitlink that moves backwards fails, and the message names both', () => {
	const verdict = judge({path: 'vendor/one', base: BASE, head: HEAD}, 'backward');
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /vendor\/one/);
	assert.match(verdict.message, /bbbbbbbbbbbb/);
	assert.match(verdict.message, /aaaaaaaaaaaa/);
	assert.match(verdict.message, /backwards/);
});

test('a gitlink on another line of history fails', () => {
	const verdict = judge({path: 'vendor/one', base: BASE, head: HEAD}, 'unrelated');
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /another line of history/);
});

test('an unmoved gitlink passes without an ancestry answer', () => {
	const verdict = judge({path: 'vendor/one', base: BASE, head: BASE});
	assert.equal(verdict.ok, true);
});

test('a submodule the branch adds passes', () => {
	const verdict = judge({path: 'vendor/new', head: HEAD});
	assert.equal(verdict.ok, true);
	assert.match(verdict.message, /added/);
});

test('a submodule the branch removes passes', () => {
	const verdict = judge({path: 'vendor/gone', base: BASE});
	assert.equal(verdict.ok, true);
	assert.match(verdict.message, /removed/);
});

// A check that cannot check must not report success. The submodule's history is
// what answers the question, and a shallow clone can be missing the commit the
// base branch names.
test('a pair that could not be compared fails', () => {
	const verdict = judge({path: 'vendor/one', base: BASE, head: HEAD});
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /cannot be compared/);
});
