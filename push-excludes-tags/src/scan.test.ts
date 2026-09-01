import * as assert from 'assert/strict';
import {test} from 'node:test';
import {formatViolation, scanWorkflow} from './scan';

test('a bare push trigger is a violation', () => {
	const found = scanWorkflow('ci.yml', 'on:\n  push:\n\njobs: {}\n');
	assert.equal(found.length, 1);
	assert.equal(found[0].line, 2);
});

test('a push filter naming only paths is a violation', () => {
	const found = scanWorkflow('ci.yml', "on:\n  push:\n    paths:\n      - 'src/**'\n");
	assert.equal(found.length, 1);
});

test('branches keeps a workflow off tag pushes', () => {
	assert.deepEqual(scanWorkflow('ci.yml', "on:\n  push:\n    branches:\n      - '**'\n"), []);
});

test('tags-ignore keeps a workflow off tag pushes', () => {
	assert.deepEqual(scanWorkflow('ci.yml', "on:\n  push:\n    tags-ignore:\n      - '**'\n"), []);
});

test('a workflow that asks for tags on purpose passes', () => {
	assert.deepEqual(scanWorkflow('release.yml', "on:\n  push:\n    tags:\n      - 'v*'\n"), []);
});

test('a scalar and a list trigger are violations', () => {
	assert.equal(scanWorkflow('ci.yml', 'on: push\n').length, 1);
	assert.equal(scanWorkflow('ci.yml', 'on: [push, workflow_dispatch]\n').length, 1);
});

test('a workflow with no push trigger passes', () => {
	assert.deepEqual(scanWorkflow('ci.yml', 'on:\n  workflow_dispatch:\n'), []);
	assert.deepEqual(scanWorkflow('ci.yml', 'on: [workflow_dispatch]\n'), []);
	assert.deepEqual(scanWorkflow('ci.yml', 'jobs: {}\n'), []);
});

test('the quoted on key reads the same as the bare one', () => {
	assert.equal(scanWorkflow('ci.yml', '"on":\n  push:\n').length, 1);
});

test('a finding names the file and the fix', () => {
	const message = formatViolation({file: 'ci.yml', line: 2, detail: 'bare `push:` names no filter'});
	assert.match(message, /^ci\.yml:2: /);
	assert.match(message, /branches/);
});
