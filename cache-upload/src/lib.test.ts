import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {ENVELOPE_MAGIC, EnvelopeHeader, KEY_PREFIX, VERSION_SEED, encodeEnvelope, handoffKey, handoffRestorePrefix, handoffVersion, parseEnvelope, validateName} from './lib';

// This file is intentionally BYTE-IDENTICAL in cache-upload and
// cache-download: it pins the wire-level constants both sides must agree on.

test('pinned wire constants', () => {
	assert.equal(KEY_PREFIX, 'cache-xfer');
	assert.equal(VERSION_SEED, 'wow-look-at-my/actions/cache-xfer/v1');
	assert.equal(ENVELOPE_MAGIC, 'WXFR1');
});

test('handoffKey layout', () => {
	assert.equal(handoffKey('go-build', '123456', '2'), 'cache-xfer-go-build-123456-2');
});

test('handoffKey rejects oversized keys', () => {
	assert.throws(() => handoffKey('x'.repeat(600), '1', '1'), /at most 512/);
});

test('handoffRestorePrefix layout', () => {
	assert.equal(handoffRestorePrefix('go-build', '123456'), 'cache-xfer-go-build-123456-');
	assert.ok(handoffKey('go-build', '123456', '7').startsWith(handoffRestorePrefix('go-build', '123456')));
});

test('handoffVersion is sha256 of the literal seed', () => {
	const expected = createHash('sha256').update('wow-look-at-my/actions/cache-xfer/v1').digest('hex');
	assert.equal(handoffVersion(), expected);
	assert.match(handoffVersion(), /^[0-9a-f]{64}$/);
});

test('validateName', () => {
	assert.doesNotThrow(() => validateName('go-build'));
	assert.throws(() => validateName(''), /must not be empty/);
	assert.throws(() => validateName('a,b'), /commas/);
});

test('envelope round-trip (tar mode)', () => {
	const header: EnvelopeHeader = {mode: 'tar', codec: 'zstd'};
	const encoded = encodeEnvelope(header);
	const parsed = parseEnvelope(Buffer.concat([encoded, Buffer.from('payload-bytes')]));
	assert.deepEqual(parsed.header, header);
	assert.equal(parsed.dataOffset, encoded.length);
});

test('envelope round-trip (raw mode)', () => {
	const header: EnvelopeHeader = {mode: 'raw', codec: 'zstd', basename: 'go-toolchain', fileMode: 0o755};
	const parsed = parseEnvelope(encodeEnvelope(header));
	assert.deepEqual(parsed.header, header);
});

test('envelope magic starts the archive', () => {
	assert.ok(encodeEnvelope({mode: 'tar', codec: 'zstd'}).subarray(0, 5).equals(Buffer.from('WXFR1')));
});

test('parseEnvelope rejects bad input', () => {
	assert.throws(() => parseEnvelope(Buffer.from('NOTIT' + '\0\0\0\0')), /magic/);
	assert.throws(() => parseEnvelope(Buffer.from('WX')), /truncated/);
	const truncated = encodeEnvelope({mode: 'tar', codec: 'zstd'});
	assert.throws(() => parseEnvelope(truncated.subarray(0, truncated.length - 2)), /truncated/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'zip'})), /mode 'zip'/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'tar', codec: 'lz4'})), /codec 'lz4'/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'raw', codec: 'zstd'})), /basename/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'raw', codec: 'zstd', basename: '../evil'})), /basename/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'raw', codec: 'zstd', basename: 'a/b'})), /basename/);
	assert.throws(() => parseEnvelope(mangleHeader({mode: 'raw', codec: 'zstd', basename: 'ok', fileMode: -5})), /fileMode/);
});

/** Build an envelope around an arbitrary (possibly invalid) header object. */
function mangleHeader(header: object): Buffer {
	const json = Buffer.from(JSON.stringify(header), 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(json.length, 0);
	return Buffer.concat([Buffer.from('WXFR1', 'latin1'), len, json]);
}
