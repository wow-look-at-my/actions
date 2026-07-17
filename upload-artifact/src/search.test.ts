import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {findFilesToUpload, getMultiPathLCA} from './search';

function makeTree(): string {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ghart-search-'));
	fs.mkdirSync(path.join(base, 'dir', 'sub'), {recursive: true});
	fs.mkdirSync(path.join(base, 'other'), {recursive: true});
	fs.mkdirSync(path.join(base, 'dir', 'empty'), {recursive: true});
	fs.writeFileSync(path.join(base, 'dir', 'a.txt'), 'a');
	fs.writeFileSync(path.join(base, 'dir', 'skip.txt'), 'skip me');
	fs.writeFileSync(path.join(base, 'dir', 'sub', 'b.txt'), 'b');
	fs.writeFileSync(path.join(base, 'dir', '.hidden.txt'), 'hidden');
	fs.writeFileSync(path.join(base, 'other', 'c.txt'), 'c');
	return base;
}

test('single bare file: root is the parent directory (structure not preserved)', async () => {
	const base = makeTree();
	const file = path.join(base, 'dir', 'a.txt');
	const result = await findFilesToUpload(file);
	assert.deepEqual(result.filesToUpload, [file]);
	assert.equal(result.rootDirectory, path.join(base, 'dir'));
	fs.rmSync(base, {recursive: true, force: true});
});

test('single directory: root is the directory, descendants included, dirs filtered out', async () => {
	const base = makeTree();
	const dir = path.join(base, 'dir');
	const result = await findFilesToUpload(dir);
	assert.deepEqual(
		[...result.filesToUpload].sort(),
		[path.join(dir, 'a.txt'), path.join(dir, 'skip.txt'), path.join(dir, 'sub', 'b.txt')].sort()
	);
	assert.equal(result.rootDirectory, dir);
	fs.rmSync(base, {recursive: true, force: true});
});

test('multiple search paths: root is the least common ancestor', async () => {
	const base = makeTree();
	const pattern = `${path.join(base, 'dir', 'a.txt')}\n${path.join(base, 'other', 'c.txt')}`;
	const result = await findFilesToUpload(pattern);
	assert.deepEqual(
		[...result.filesToUpload].sort(),
		[path.join(base, 'dir', 'a.txt'), path.join(base, 'other', 'c.txt')].sort()
	);
	assert.equal(result.rootDirectory, base);
	fs.rmSync(base, {recursive: true, force: true});
});

test('! exclusion patterns subtract earlier matches', async () => {
	const base = makeTree();
	const dir = path.join(base, 'dir');
	const pattern = `${dir}\n!${path.join(dir, 'skip.txt')}`;
	const result = await findFilesToUpload(pattern);
	assert.deepEqual(
		[...result.filesToUpload].sort(),
		[path.join(dir, 'a.txt'), path.join(dir, 'sub', 'b.txt')].sort()
	);
	fs.rmSync(base, {recursive: true, force: true});
});

test('hidden files are excluded by default and included on request', async () => {
	const base = makeTree();
	const dir = path.join(base, 'dir');
	const withoutHidden = await findFilesToUpload(dir);
	assert.ok(!withoutHidden.filesToUpload.includes(path.join(dir, '.hidden.txt')));
	const withHidden = await findFilesToUpload(dir, true);
	assert.ok(withHidden.filesToUpload.includes(path.join(dir, '.hidden.txt')));
	fs.rmSync(base, {recursive: true, force: true});
});

test('getMultiPathLCA table cases', () => {
	assert.equal(getMultiPathLCA(['/foo/bar', '/foo/voo']), path.normalize('/foo'));
	assert.equal(getMultiPathLCA(['/foo/bar/one', '/foo/bar/two', '/foo/mo']), path.normalize('/foo'));
	assert.equal(getMultiPathLCA(['/foo', '/bar']), path.normalize('/'));
	assert.throws(() => getMultiPathLCA(['/only-one']));
});
