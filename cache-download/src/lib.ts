import * as crypto from 'crypto';

// This file is intentionally BYTE-IDENTICAL in cache-upload/src/lib.ts and
// cache-download/src/lib.ts (each action dir is a self-contained package —
// repo convention). Keep them in sync; the constants below are additionally
// pinned by tests in both packages.

/** Key prefix shared by cache-upload, cache-download, and cache-cleanup. */
export const KEY_PREFIX = 'cache-xfer';

/**
 * Seed of the constant cache "version" sent to the cache service.
 *
 * The service treats `version` as an opaque request parameter alongside the
 * key; the path/compression-derived sha256 that actions/cache sends is purely
 * client-side convention (computed in @actions/cache 5.2.0,
 * lib/internal/cacheUtils.js:202-217, from the literal path spec strings). We
 * send sha256 of this literal instead, so version never depends on user
 * input and upload/download need no path contract at all.
 *
 * Bump the trailing revision whenever the envelope layout or codec set
 * changes: mixed-revision producers/consumers then land on different
 * versions, turning a would-be misparse into a clean cache miss.
 */
export const VERSION_SEED = 'wow-look-at-my/actions/cache-xfer/v1';

/** Magic bytes opening every hand-off archive. */
export const ENVELOPE_MAGIC = 'WXFR1';

/** The cache service rejects keys longer than 512 characters. */
const MAX_KEY_LENGTH = 512;

/** Sanity bound for the envelope's JSON header. */
export const MAX_HEADER_BYTES = 64 * 1024;

export function validateName(name: string): void {
	if (!name) {
		throw new Error("The 'name' input must not be empty");
	}
	if (name.includes(',')) {
		throw new Error("The 'name' input must not contain commas (commas are invalid in cache keys)");
	}
}

/** Exact key for this hand-off: unique per (name, run, attempt). */
export function handoffKey(name: string, runId: string, runAttempt: string): string {
	const key = `${KEY_PREFIX}-${name}-${runId}-${runAttempt}`;
	if (key.length > MAX_KEY_LENGTH) {
		throw new Error(`Hand-off cache key is ${key.length} characters; the cache service allows at most ${MAX_KEY_LENGTH}. Use a shorter 'name'.`);
	}
	return key;
}

/**
 * Run-scoped restore prefix: matches any attempt of this run, so
 * "re-run failed jobs" (new attempt, producer not re-run) still restores the
 * newest earlier attempt's files.
 */
export function handoffRestorePrefix(name: string, runId: string): string {
	return `${KEY_PREFIX}-${name}-${runId}-`;
}

/** The constant version sent with every CreateCacheEntry/GetCacheEntryDownloadURL. */
export function handoffVersion(): string {
	return crypto.createHash('sha256').update(VERSION_SEED).digest('hex');
}

/**
 * Self-describing envelope, so the download side needs nothing from the key:
 *
 *   'WXFR1' | uint32 BE header length | header JSON | compressed payload
 *
 * mode 'raw' is the single-file fast path (no tar process at all): the file
 * body is streamed straight through the codec, and basename/fileMode let the
 * download side recreate `<dest>/<basename>` with its permission bits.
 * mode 'tar' carries a directory's contents as a tar stream (exec bits and
 * symlinks preserved by tar itself).
 */
export interface EnvelopeHeader {
	mode: 'tar' | 'raw';
	codec: 'zstd';
	basename?: string;
	fileMode?: number;
}

export function encodeEnvelope(header: EnvelopeHeader): Buffer {
	const json = Buffer.from(JSON.stringify(header), 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32BE(json.length, 0);
	return Buffer.concat([Buffer.from(ENVELOPE_MAGIC, 'latin1'), len, json]);
}

/**
 * Parse the envelope prefix from the first bytes of an archive. `buf` must
 * contain at least the magic, length, and full header JSON. Returns the
 * validated header plus the offset at which the compressed payload starts.
 */
export function parseEnvelope(buf: Buffer): {header: EnvelopeHeader; dataOffset: number} {
	const magic = Buffer.from(ENVELOPE_MAGIC, 'latin1');
	if (buf.length < magic.length + 4) {
		throw new Error('Hand-off archive is truncated (no envelope header)');
	}
	if (!buf.subarray(0, magic.length).equals(magic)) {
		throw new Error(`Hand-off archive does not start with the ${ENVELOPE_MAGIC} magic; it was not written by cache-upload`);
	}
	const headerLen = buf.readUInt32BE(magic.length);
	if (headerLen > MAX_HEADER_BYTES) {
		throw new Error(`Envelope header length ${headerLen} exceeds the ${MAX_HEADER_BYTES} byte bound`);
	}
	const headerStart = magic.length + 4;
	if (buf.length < headerStart + headerLen) {
		throw new Error('Hand-off archive is truncated (incomplete envelope header)');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(buf.subarray(headerStart, headerStart + headerLen).toString('utf8'));
	} catch {
		throw new Error('Envelope header is not valid JSON');
	}
	const header = parsed as EnvelopeHeader;
	if (header === null || typeof header !== 'object') {
		throw new Error('Envelope header is not a JSON object');
	}
	if (header.mode !== 'tar' && header.mode !== 'raw') {
		throw new Error(`Envelope mode '${String(header.mode)}' is not supported by this version of the action`);
	}
	if (header.codec !== 'zstd') {
		throw new Error(`Envelope codec '${String(header.codec)}' is not supported by this version of the action`);
	}
	if (header.mode === 'raw') {
		if (typeof header.basename !== 'string' || header.basename === '' || header.basename === '.' || header.basename === '..' || header.basename.includes('/') || header.basename.includes('\\')) {
			throw new Error(`Envelope basename ${JSON.stringify(header.basename)} is missing or unsafe`);
		}
		if (header.fileMode !== undefined && (typeof header.fileMode !== 'number' || !Number.isInteger(header.fileMode) || header.fileMode < 0 || header.fileMode > 0o7777)) {
			throw new Error(`Envelope fileMode ${JSON.stringify(header.fileMode)} is not a valid mode`);
		}
	}
	return {header, dataOffset: headerStart + headerLen};
}
