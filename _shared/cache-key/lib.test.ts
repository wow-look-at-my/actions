import * as assert from 'assert';
import {test} from 'node:test';
import {buildKey, CacheKeySpec, computeDigest, normalizeList, sanitizeLabel} from './lib';

function spec(overrides: Partial<CacheKeySpec> = {}): CacheKeySpec {
	return {scheme: 'demo-v1', platform: ['Linux', 'X64'], label: '', fields: {run: 'make build'}, ...overrides};
}

test('one spec produces one key, every time', () => {
	assert.strictEqual(buildKey(spec()).key, buildKey(spec()).key);
});

test('the key opens with readable text and ends in the digest', () => {
	const built = buildKey(spec({label: 'nightly'}));
	assert.strictEqual(built.key, `demo-v1-Linux-X64-nightly-${built.digest}`);
	assert.strictEqual(built.digest.length, 40);
});

test('an empty label leaves no double separator in the key', () => {
	assert.strictEqual(buildKey(spec()).key, `demo-v1-Linux-X64-${buildKey(spec()).digest}`);
});

test('a changed field changes the digest', () => {
	assert.notStrictEqual(computeDigest(spec()), computeDigest(spec({fields: {run: 'make build '}})));
});

test('an added field changes the digest, so a new input cannot hit an old entry', () => {
	assert.notStrictEqual(computeDigest(spec()), computeDigest(spec({fields: {run: 'make build', paths: ['dist']}})));
});

test('the order the fields object was built in does not change the digest', () => {
	const one = computeDigest(spec({fields: {alpha: 'a', beta: 'b'}}));
	const two = computeDigest(spec({fields: {beta: 'b', alpha: 'a'}}));
	assert.strictEqual(one, two);
});

test('two fields cannot concatenate into one identical byte stream', () => {
	const split = computeDigest(spec({fields: {a: 'x', b: 'y'}}));
	const joined = computeDigest(spec({fields: {a: 'xy', b: ''}}));
	assert.notStrictEqual(split, joined);
});

test('the platform is in the digest, so no runner reads another runner entry', () => {
	assert.notStrictEqual(computeDigest(spec()), computeDigest(spec({platform: ['macOS', 'X64']})));
	assert.notStrictEqual(computeDigest(spec()), computeDigest(spec({platform: ['Linux', 'ARM64']})));
});

test('the label is in the digest, so two callers running one command stay apart', () => {
	assert.notStrictEqual(computeDigest(spec({label: 'alpha'})), computeDigest(spec({label: 'beta'})));
});

test('the scheme is in the digest, so two actions never collide', () => {
	assert.notStrictEqual(computeDigest(spec()), computeDigest(spec({scheme: 'other-v1'})));
});

test('an empty scheme fails loudly rather than producing an unnamespaced key', () => {
	assert.throws(() => buildKey(spec({scheme: ''})), /needs a scheme/);
});

test('a label drops the characters a cache key rejects', () => {
	const key = buildKey(spec({label: 'node, v22 / ubuntu'})).key;
	assert.ok(!key.includes(','), key);
	assert.ok(!key.includes(' '), key);
	assert.ok(!key.includes('/'), key);
	assert.ok(key.includes('node-v22-ubuntu'), key);
});

test('a label is bounded, and never ends on a separator', () => {
	assert.strictEqual(sanitizeLabel('b'.repeat(60)).length, 48);
	// The cut lands on the separator here, and stripping it is what keeps the
	// key from ending on a dash.
	const cutOnSeparator = sanitizeLabel(`${'a'.repeat(47)}, trailing`);
	assert.strictEqual(cutOnSeparator, 'a'.repeat(47));
});

test('a label of only punctuation drops out instead of becoming a bare dash', () => {
	assert.strictEqual(sanitizeLabel('///'), '');
	const built = buildKey(spec({label: '///'}));
	assert.strictEqual(built.key, `demo-v1-Linux-X64-${built.digest}`);
});

test('a list splits on whitespace, newlines and commas', () => {
	assert.deepStrictEqual(normalizeList('a b,c\nd'), ['a', 'b', 'c', 'd']);
});

test('a list is deduplicated and sorted, so two orderings share one entry', () => {
	assert.deepStrictEqual(normalizeList('b a b'), normalizeList('a b'));
});

test('an empty list is empty rather than one empty entry', () => {
	assert.deepStrictEqual(normalizeList('  \n '), []);
});
