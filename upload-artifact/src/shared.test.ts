import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	attemptFromKey,
	attemptKeyPrefix,
	buildCacheKey,
	cacheModeBlocksWrites,
	expectedCacheVersions,
	formatBytes,
	formatGB,
	KEY_VERSION,
	nameHash16,
	parseCacheList,
	parseCacheUsage,
	PAYLOAD_DIR,
	PAYLOAD_PATH,
	sanitizeName
} from './shared';

test('contract constants are pinned', () => {
	// These literals are the compatibility contract between the
	// independently-published upload and download actions. Changing either
	// means bumping KEY_VERSION in BOTH action directories in one PR.
	assert.equal(KEY_VERSION, 'ghart-v1');
	assert.equal(PAYLOAD_DIR, '.gha-cache-artifact.tmp');
	assert.equal(PAYLOAD_PATH, '.gha-cache-artifact.tmp/payload.tar');
});

test('sanitizeName strips commas, whitespace, and control chars to dashes', () => {
	assert.equal(sanitizeName('plain-name'), 'plain-name');
	assert.equal(sanitizeName('a,b c\td'), 'a-b-c-d');
	assert.equal(sanitizeName('nl\nand\rcr'), 'nl-and-cr');
	assert.equal(sanitizeName(`ctl${String.fromCharCode(1, 31, 127)}end`), 'ctl---end');
});

test('sanitizeName clamps to 100 characters', () => {
	const long = 'x'.repeat(250);
	assert.equal(sanitizeName(long).length, 100);
});

test('nameHash16 is 16 lowercase hex chars, deterministic, name-sensitive', () => {
	const h = nameHash16('artifact');
	assert.match(h, /^[0-9a-f]{16}$/);
	assert.equal(h, nameHash16('artifact'));
	assert.notEqual(h, nameHash16('artifact2'));
});

test('buildCacheKey has the documented shape and satisfies cache-key constraints', () => {
	const key = buildCacheKey('16049800000', '2', 'my artifact, with junk');
	assert.match(key, /^ghart-v1-16049800000-[0-9a-f]{16}-a2-my-artifact--with-junk$/);
	assert.ok(key.length <= 512);
	assert.ok(!key.includes(','));
});

test('a hostile 250-char name still yields a valid key', () => {
	const key = buildCacheKey('99999999999', '99', ','.repeat(250));
	assert.ok(key.length <= 512);
	assert.ok(!key.includes(','));
});

test('prefix-collision property: an attempt prefix matches exactly its own (runId, name) keys', () => {
	// Names deliberately chosen to collide textually if the fixed-length name
	// hash were absent: 'x' vs 'x-a1', 'foo' vs 'foo-2'; run ids that are
	// prefixes of each other: 1, 12, 123.
	const names = ['x', 'x-a1', 'foo', 'foo-2', 'a'.repeat(200)];
	const runIds = ['1', '12', '123', '1234'];
	const attempts = ['1', '2', '10'];
	for (const r1 of runIds) {
		for (const n1 of names) {
			const prefix = attemptKeyPrefix(r1, n1);
			for (const r2 of runIds) {
				for (const n2 of names) {
					for (const att of attempts) {
						const key = buildCacheKey(r2, att, n2);
						const matches = key.startsWith(prefix);
						const same = r1 === r2 && n1 === n2;
						assert.equal(
							matches,
							same,
							`prefix(${r1}, ${JSON.stringify(n1)}) vs key(${r2}, a${att}, ${JSON.stringify(n2)}): matches=${matches} expected=${same}`
						);
					}
				}
			}
		}
	}
});

test('attemptFromKey extracts the attempt from own keys and rejects foreign keys', () => {
	const key = buildCacheKey('42', '7', 'thing');
	assert.equal(attemptFromKey(key, '42', 'thing'), '7');
	assert.equal(attemptFromKey(key, '42', 'other'), undefined);
	assert.equal(attemptFromKey(key, '43', 'thing'), undefined);
	assert.equal(attemptFromKey(`${attemptKeyPrefix('42', 'thing')}notdigits`, '42', 'thing'), undefined);
});

test('parseCacheList tolerates malformed bodies and parses valid ones', () => {
	assert.deepEqual(parseCacheList(undefined), []);
	assert.deepEqual(parseCacheList(null), []);
	assert.deepEqual(parseCacheList('nope'), []);
	assert.deepEqual(parseCacheList({}), []);
	assert.deepEqual(parseCacheList({actions_caches: 'nope'}), []);
	const parsed = parseCacheList({
		total_count: 1,
		actions_caches: [
			{
				id: 5,
				ref: 'refs/heads/main',
				key: 'k',
				version: 'v',
				created_at: '2026-01-01T00:00:00Z',
				size_in_bytes: 123
			}
		]
	});
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].id, 5);
	assert.equal(parsed[0].ref, 'refs/heads/main');
	assert.equal(parsed[0].size_in_bytes, 123);
	// missing fields default rather than crash
	const defaulted = parseCacheList({actions_caches: [{}]});
	assert.equal(defaulted[0].id, 0);
	assert.equal(defaulted[0].key, '');
});

test('parseCacheUsage parses valid bodies and rejects malformed ones', () => {
	assert.equal(parseCacheUsage(null), undefined);
	assert.equal(parseCacheUsage({}), undefined);
	assert.equal(parseCacheUsage({active_caches_count: 'x', active_caches_size_in_bytes: 1}), undefined);
	const u = parseCacheUsage({full_name: 'o/r', active_caches_count: 3, active_caches_size_in_bytes: 4096});
	assert.deepEqual(u, {active_caches_count: 3, active_caches_size_in_bytes: 4096});
});

test('cacheModeBlocksWrites only for read/none', () => {
	assert.equal(cacheModeBlocksWrites('read'), true);
	assert.equal(cacheModeBlocksWrites('none'), true);
	assert.equal(cacheModeBlocksWrites('write'), false);
	assert.equal(cacheModeBlocksWrites('write-only'), false);
	assert.equal(cacheModeBlocksWrites(''), false);
	assert.equal(cacheModeBlocksWrites(undefined), false);
});

test('expectedCacheVersions yields four distinct sha256 hex strings', () => {
	const versions = expectedCacheVersions();
	assert.equal(versions.length, 4);
	assert.equal(new Set(versions).size, 4);
	for (const v of versions) {
		assert.match(v, /^[0-9a-f]{64}$/);
	}
});

test('formatBytes and formatGB', () => {
	assert.equal(formatBytes(512), '512 B');
	assert.equal(formatBytes(2048), '2.00 KiB');
	assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MiB');
	assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.00 GiB');
	assert.equal(formatGB(2.5e9), '2.50 GB');
});
