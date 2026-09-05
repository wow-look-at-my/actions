import * as assert from 'node:assert/strict';
import {test} from 'node:test';
import {isWorkflowFile, scanWorkflowYaml} from './scan';

test('a bare push trigger is unfiltered', () => {
	const findings = scanWorkflowYaml('name: CI\non:\n  push:\njobs: {}\n');
	assert.equal(findings.length, 1);
	// The reader edits the `push:` key, so that is where the finding sits.
	assert.equal(findings[0].line, 3);
});

test('a branch filter clears the trigger', () => {
	assert.deepEqual(scanWorkflowYaml("on:\n  push:\n    branches: ['**']\n"), []);
});

test('a tags-ignore filter clears the trigger', () => {
	assert.deepEqual(scanWorkflowYaml("on:\n  push:\n    tags-ignore: ['**']\n"), []);
});

test('a push key carrying only unrelated keys is still unfiltered', () => {
	const findings = scanWorkflowYaml("on:\n  push:\n    paths: ['src/**']\n");
	assert.equal(findings.length, 1);
});

test('the scalar form names the on key, since there is no push key to point at', () => {
	const findings = scanWorkflowYaml('on: push\n');
	assert.equal(findings.length, 1);
	assert.equal(findings[0].line, 1);
});

test('the sequence form is unfiltered', () => {
	assert.equal(scanWorkflowYaml('on: [push, pull_request]\n').length, 1);
});

test('a workflow with no push trigger is clean', () => {
	assert.deepEqual(scanWorkflowYaml('on:\n  workflow_dispatch:\n'), []);
});

// `on` is a boolean in YAML 1.1. The core schema this parser uses keeps it a
// string, and a version that did not would silently find no trigger at all.
test('the on key is read as a string, not as a boolean', () => {
	assert.equal(scanWorkflowYaml('on:\n  push:\n').length, 1);
});

test('unparseable YAML contributes nothing', () => {
	assert.deepEqual(scanWorkflowYaml('on:\n  push:\n :::not yaml\n\t\tbad\n'), []);
});

test('only workflow files are in scope', () => {
	assert.ok(isWorkflowFile('.github/workflows/ci.yml'));
	assert.ok(isWorkflowFile('.github/workflows/ci.yaml'));
	assert.ok(!isWorkflowFile('action.yml'));
	assert.ok(!isWorkflowFile('.github/workflows/nested/ci.yml'));
});
