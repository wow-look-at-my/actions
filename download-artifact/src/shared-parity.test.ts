import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('shared.ts is byte-identical to upload-artifact/src/shared.ts', () => {
	// The key format and payload layout are a compatibility contract between
	// the two independently-published actions; the file is deliberately
	// duplicated instead of imported across action directories. This test is
	// the guard: any drift means someone changed one copy without the other.
	const ours = fs.readFileSync(path.join(__dirname, 'shared.ts'));
	const theirs = fs.readFileSync(path.join(__dirname, '..', '..', 'upload-artifact', 'src', 'shared.ts'));
	assert.ok(
		ours.equals(theirs),
		'download-artifact/src/shared.ts differs from upload-artifact/src/shared.ts -- the ghart contract file must be duplicated byte-for-byte; copy one over the other (and bump KEY_VERSION in BOTH if the contract changed)'
	);
});
