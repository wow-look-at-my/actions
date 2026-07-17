import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {execFileSync} from 'child_process';
import {
	ArtifactMeta,
	buildPayloadTar,
	extractPayload,
	listPayloadFiles,
	META_NAME,
	readPayloadMeta
} from './shared';

test('payload tar round-trip: tree/content/mode parity, meta first + readable + excluded', async () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ghart-tar-'));
	try {
		const root = path.join(base, 'root');
		fs.mkdirSync(path.join(root, 'sub', 'deep'), {recursive: true});
		fs.writeFileSync(path.join(root, 'top.txt'), 'top contents\n');
		fs.writeFileSync(path.join(root, 'sub', 'deep', 'nested.txt'), 'nested contents\n');
		fs.writeFileSync(path.join(root, 'sub', 'run.sh'), '#!/bin/sh\necho ok\n');
		fs.chmodSync(path.join(root, 'sub', 'run.sh'), 0o755);
		fs.writeFileSync(path.join(root, 'file with spaces.txt'), 'spacey\n');
		fs.writeFileSync(path.join(root, '-leading-dash.txt'), 'dashy\n');
		fs.writeFileSync(path.join(root, 'target.txt'), 'link target\n');
		fs.symlinkSync('target.txt', path.join(root, 'link.txt'));

		const rels = [
			'top.txt',
			'sub/deep/nested.txt',
			'sub/run.sh',
			'file with spaces.txt',
			'-leading-dash.txt',
			'target.txt',
			'link.txt'
		];
		const meta: ArtifactMeta = {
			formatVersion: 1,
			name: 'roundtrip',
			runId: '123',
			runAttempt: '1',
			fileCount: rels.length,
			totalBytes: 0,
			createdAt: '2026-07-17T00:00:00.000Z',
			repo: 'wow-look-at-my/actions'
		};

		const staging = path.join(base, 'staging');
		const payload = buildPayloadTar(staging, root, rels, meta);
		assert.ok(fs.existsSync(payload));

		// The meta document is the FIRST entry and is readable without extraction.
		const entries = execFileSync('tar', ['-t', '-f', payload])
			.toString('utf8')
			.split('\n')
			.filter((l) => l !== '');
		assert.equal(entries[0], META_NAME);
		const readBack = readPayloadMeta(payload);
		assert.equal(readBack.name, 'roundtrip');
		assert.equal(readBack.runId, '123');
		assert.equal(readBack.fileCount, rels.length);

		// listPayloadFiles: exactly the user files, meta excluded.
		assert.deepEqual([...listPayloadFiles(payload)].sort(), [...rels].sort());

		// Extraction: parity, meta never lands.
		const out = path.join(base, 'out');
		extractPayload(payload, out);
		assert.ok(!fs.existsSync(path.join(out, META_NAME)));
		assert.equal(fs.readFileSync(path.join(out, 'top.txt'), 'utf8'), 'top contents\n');
		assert.equal(fs.readFileSync(path.join(out, 'sub', 'deep', 'nested.txt'), 'utf8'), 'nested contents\n');
		assert.equal(fs.readFileSync(path.join(out, 'file with spaces.txt'), 'utf8'), 'spacey\n');
		assert.equal(fs.readFileSync(path.join(out, '-leading-dash.txt'), 'utf8'), 'dashy\n');

		// Executable bit survives.
		assert.ok(fs.statSync(path.join(out, 'sub', 'run.sh')).mode & 0o100, 'exec bit lost');

		// Symlinks are dereferenced (upstream upload-artifact semantics): the
		// extracted entry is a REGULAR file carrying the target's bytes.
		const linkStat = fs.lstatSync(path.join(out, 'link.txt'));
		assert.ok(linkStat.isFile(), 'symlink was not dereferenced into a regular file');
		assert.equal(fs.readFileSync(path.join(out, 'link.txt'), 'utf8'), 'link target\n');
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});
