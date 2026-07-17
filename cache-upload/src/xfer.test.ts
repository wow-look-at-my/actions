import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {test} from 'node:test';
import {packToFile, readEnvelope, unpackFromFile} from './xfer';

// Local pack/unpack round-trips (spawns real tar + zstd; no cache service).
// This file is intentionally BYTE-IDENTICAL in cache-upload and
// cache-download so a packer change cannot silently break the unpacker.

async function tempDir(): Promise<string> {
	return fsp.mkdtemp(path.join(os.tmpdir(), 'cache-xfer-test-'));
}

test('directory round-trip preserves tree, exec bits, symlinks, dotfiles', async t => {
	const src = await tempDir();
	const work = await tempDir();
	const dest = path.join(await tempDir(), 'restored');
	t.after(async () => {
		for (const dir of [src, work, path.dirname(dest)]) {
			await fsp.rm(dir, {recursive: true, force: true});
		}
	});

	await fsp.mkdir(path.join(src, 'sub', 'deep'), {recursive: true});
	await fsp.writeFile(path.join(src, 'plain.txt'), 'hello handoff');
	await fsp.writeFile(path.join(src, 'sub', 'deep', 'nested.bin'), Buffer.from([0, 1, 2, 254, 255]));
	await fsp.writeFile(path.join(src, 'tool'), '#!/bin/sh\necho ok\n', {mode: 0o755});
	await fsp.writeFile(path.join(src, '.hidden'), 'dotfile survives');
	await fsp.symlink('plain.txt', path.join(src, 'link'));

	const archive = path.join(work, 'archive.wxfr');
	const packed = await packToFile(src, archive);
	assert.equal(packed.mode, 'tar');
	assert.equal(packed.codec, 'zstd');

	const {header} = await readEnvelope(archive);
	assert.deepEqual(header, packed);

	const unpacked = await unpackFromFile(archive, dest);
	assert.equal(unpacked.mode, 'tar');

	assert.equal(await fsp.readFile(path.join(dest, 'plain.txt'), 'utf8'), 'hello handoff');
	assert.deepEqual(await fsp.readFile(path.join(dest, 'sub', 'deep', 'nested.bin')), Buffer.from([0, 1, 2, 254, 255]));
	assert.equal(await fsp.readFile(path.join(dest, '.hidden'), 'utf8'), 'dotfile survives');
	const toolMode = (await fsp.stat(path.join(dest, 'tool'))).mode & 0o777;
	assert.equal(toolMode & 0o111, 0o111, `exec bits survive (got ${toolMode.toString(8)})`);
	assert.equal(await fsp.readlink(path.join(dest, 'link')), 'plain.txt');
});

test('single-file round-trip uses raw mode and restores basename + mode', async t => {
	const src = await tempDir();
	const work = await tempDir();
	const dest = path.join(await tempDir(), 'raw-out');
	t.after(async () => {
		for (const dir of [src, work, path.dirname(dest)]) {
			await fsp.rm(dir, {recursive: true, force: true});
		}
	});

	const file = path.join(src, 'go-toolchain');
	const body = Buffer.concat([Buffer.from('binary-ish '), Buffer.from([0, 7, 255])]);
	await fsp.writeFile(file, body, {mode: 0o755});

	const archive = path.join(work, 'archive.wxfr');
	const packed = await packToFile(file, archive);
	assert.equal(packed.mode, 'raw');
	assert.equal(packed.basename, 'go-toolchain');
	assert.equal((packed.fileMode as number) & 0o111, 0o111);

	const unpacked = await unpackFromFile(archive, dest);
	assert.equal(unpacked.mode, 'raw');
	const restored = path.join(dest, 'go-toolchain');
	assert.deepEqual(await fsp.readFile(restored), body);
	assert.equal((await fsp.stat(restored)).mode & 0o111, 0o111);
});

test('packToFile rejects a missing path', async () => {
	const work = await tempDir();
	await assert.rejects(packToFile(path.join(work, 'nope'), path.join(work, 'a.wxfr')), /does not exist/);
	await fsp.rm(work, {recursive: true, force: true});
});

test('unpackFromFile rejects a non-envelope file', async () => {
	const work = await tempDir();
	const bogus = path.join(work, 'bogus');
	await fsp.writeFile(bogus, 'this is not an envelope at all');
	await assert.rejects(unpackFromFile(bogus, path.join(work, 'out')), /magic/);
	await fsp.rm(work, {recursive: true, force: true});
});
