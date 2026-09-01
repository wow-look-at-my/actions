import * as assert from 'assert/strict';
import {test} from 'node:test';
import {resolve} from './permissions';

const workflow = (body: string) => `name: CI\non:\n  push:\n    branches: ['**']\n${body}`;

test('a job block grants the scope it names', () => {
	const found = resolve(workflow("jobs:\n  build:\n    permissions:\n      id-token: write\n"), 'build', 'id-token', 'write');
	assert.deepEqual(found, {granted: true, level: 'write', source: 'job'});
});

test('the workflow block covers a job that declares nothing', () => {
	const found = resolve(workflow("permissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n"), 'build', 'contents', 'read');
	assert.deepEqual(found, {granted: true, level: 'read', source: 'workflow'});
});

test('a job block replaces the workflow block rather than merging with it', () => {
	const content = workflow("permissions:\n  id-token: write\njobs:\n  build:\n    permissions:\n      contents: read\n");
	assert.deepEqual(resolve(content, 'build', 'id-token', 'write'), {granted: false, level: 'none', source: 'job'});
});

test('write satisfies a read request, read does not satisfy a write request', () => {
	const content = workflow("jobs:\n  build:\n    permissions:\n      contents: write\n");
	assert.equal(resolve(content, 'build', 'contents', 'read').granted, true);
	const readOnly = workflow("jobs:\n  build:\n    permissions:\n      contents: read\n");
	assert.equal(resolve(readOnly, 'build', 'contents', 'write').granted, false);
});

test('write-all grants every scope and read-all grants read', () => {
	assert.equal(resolve(workflow("jobs:\n  build:\n    permissions: write-all\n"), 'build', 'packages', 'write').granted, true);
	assert.equal(resolve(workflow("permissions: read-all\njobs:\n  build: {}\n"), 'build', 'packages', 'write').granted, false);
});

test('an empty block grants nothing', () => {
	const found = resolve(workflow("jobs:\n  build:\n    permissions: {}\n"), 'build', 'contents', 'read');
	assert.deepEqual(found, {granted: false, level: 'none', source: 'job'});
});

test('a scope declared none is not granted', () => {
	const content = workflow("permissions:\n  contents: none\njobs:\n  build: {}\n");
	assert.deepEqual(resolve(content, 'build', 'contents', 'read'), {granted: false, level: 'none', source: 'workflow'});
});

test('no block anywhere reports the repository default', () => {
	const found = resolve(workflow("jobs:\n  build:\n    runs-on: ubuntu-latest\n"), 'build', 'contents', 'read');
	assert.deepEqual(found, {granted: false, level: 'none', source: 'default'});
});

test('an unknown job names the jobs the file does have', () => {
	assert.throws(
		() => resolve(workflow("jobs:\n  build: {}\n  test: {}\n"), 'lint', 'contents', 'read'),
		/names no job 'lint'\. It has: build, test/,
	);
});

test('a level the schema does not have is an error', () => {
	assert.throws(
		() => resolve(workflow("jobs:\n  build:\n    permissions:\n      contents: readwrite\n"), 'build', 'contents', 'read'),
		/not read, write or none/,
	);
});
