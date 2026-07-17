import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEY_PREFIX, isAgedOut, isRunEntry, listPrefix, parseMaxAge} from './lib';

test('pinned key prefix matches cache-upload/cache-download', () => {
	assert.equal(KEY_PREFIX, 'cache-xfer');
});

test('listPrefix', () => {
	assert.equal(listPrefix(), 'cache-xfer-');
	assert.equal(listPrefix('go-build'), 'cache-xfer-go-build-');
});

test('isRunEntry matches this run, any attempt, any name', () => {
	assert.ok(isRunEntry('cache-xfer-go-build-123456-1', '123456'));
	assert.ok(isRunEntry('cache-xfer-go-build-123456-7', '123456'));
	assert.ok(isRunEntry('cache-xfer-name-with-2-digits-123456-1', '123456'));
});

test('isRunEntry scoped to a name', () => {
	assert.ok(isRunEntry('cache-xfer-go-build-123456-1', '123456', 'go-build'));
	assert.ok(!isRunEntry('cache-xfer-other-123456-1', '123456', 'go-build'));
	assert.ok(isRunEntry('cache-xfer-go-build-2-123456-1', '123456', 'go-build-2'));
});

test('isRunEntry never matches other runs', () => {
	assert.ok(!isRunEntry('cache-xfer-go-build-999999-1', '123456'));
	// A short run id must not match inside a longer one: the dash before the
	// run id anchors it.
	assert.ok(!isRunEntry('cache-xfer-foo-123-9', '3'));
	assert.ok(!isRunEntry('cache-xfer-foo-123-9', '23'));
	// Attempt segment must be numeric and terminal.
	assert.ok(!isRunEntry('cache-xfer-foo-123456-', '123456'));
	assert.ok(!isRunEntry('cache-xfer-foo-123456-1-extra', '123456'));
	// Other namespaces are never touched.
	assert.ok(!isRunEntry('setup-go-Linux-123456-1', '123456'));
});

test('parseMaxAge', () => {
	assert.equal(parseMaxAge('12h'), 12 * 3_600_000);
	assert.equal(parseMaxAge('90m'), 90 * 60_000);
	assert.equal(parseMaxAge('2d'), 2 * 86_400_000);
	assert.equal(parseMaxAge('0'), 0);
	assert.throws(() => parseMaxAge('12'), /Invalid max-age/);
	assert.throws(() => parseMaxAge('h'), /Invalid max-age/);
	assert.throws(() => parseMaxAge('1w'), /Invalid max-age/);
});

test('isAgedOut', () => {
	const now = Date.parse('2026-07-17T12:00:00Z');
	const old = '2026-07-16T00:00:00Z'; // 36h before now
	const fresh = '2026-07-17T11:00:00Z'; // 1h before now
	assert.ok(isAgedOut(old, undefined, now, parseMaxAge('12h')));
	assert.ok(!isAgedOut(fresh, undefined, now, parseMaxAge('12h')));
	// last_accessed_at wins over created_at
	assert.ok(!isAgedOut(fresh, old, now, parseMaxAge('12h')));
	// falls back to created_at when never accessed
	assert.ok(isAgedOut(undefined, old, now, parseMaxAge('12h')));
	// '0' disables the sweep entirely
	assert.ok(!isAgedOut(old, old, now, 0));
	// unknown timestamps are never swept
	assert.ok(!isAgedOut(undefined, undefined, now, parseMaxAge('12h')));
	assert.ok(!isAgedOut('garbage', undefined, now, parseMaxAge('12h')));
});
