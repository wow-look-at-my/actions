import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	ArtifactMeta,
	buildPayloadTar,
	extractPayload,
	listPayloadFiles,
	META_NAME,
	readPayloadMeta,
	sha256File
} from './shared';

test('extraction side of the payload round-trip: content lands, meta stays out but is readable', async () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ghart-extract-'));
	try {
		const root = path.join(base, 'root');
		fs.mkdirSync(path.join(root, 'nested'), {recursive: true});
		fs.writeFileSync(path.join(root, 'a.bin'), Buffer.from([0, 1, 2, 250, 251, 252]));
		fs.writeFileSync(path.join(root, 'nested', 'b.txt'), 'b contents\n');

		const meta: ArtifactMeta = {
			formatVersion: 1,
			name: 'extract-side',
			runId: '77',
			runAttempt: '2',
			fileCount: 2,
			totalBytes: 17,
			createdAt: '2026-07-17T00:00:00.000Z',
			repo: 'wow-look-at-my/actions'
		};
		const payload = buildPayloadTar(path.join(base, 'staging'), root, ['a.bin', 'nested/b.txt'], meta);

		// Meta is readable without extraction (what the download logs).
		const readBack = readPayloadMeta(payload);
		assert.equal(readBack.name, 'extract-side');
		assert.equal(readBack.runAttempt, '2');

		// Digest is stable for identical bytes.
		assert.equal(await sha256File(payload), await sha256File(payload));

		const out = path.join(base, 'out');
		extractPayload(payload, out);
		assert.ok(!fs.existsSync(path.join(out, META_NAME)), 'meta entry leaked into the extraction target');
		assert.deepEqual(fs.readFileSync(path.join(out, 'a.bin')), Buffer.from([0, 1, 2, 250, 251, 252]));
		assert.equal(fs.readFileSync(path.join(out, 'nested', 'b.txt'), 'utf8'), 'b contents\n');
		assert.deepEqual([...listPayloadFiles(payload)].sort(), ['a.bin', 'nested/b.txt']);
	} finally {
		fs.rmSync(base, {recursive: true, force: true});
	}
});
