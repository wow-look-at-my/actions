import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ALREADY_RAN_ENV, GUARDED_NAME, REQUIRED_BUILDS_MANAGER_APP_ID, findCheckRunViolations, findJobViolations, formatViolation, isShadowJobName, scanWorkflowYaml, shouldSkip} from './detect';

test('pinned constants', () => {
	assert.equal(GUARDED_NAME, 'all-builds');
	assert.equal(REQUIRED_BUILDS_MANAGER_APP_ID, 3007670);
	assert.equal(ALREADY_RAN_ENV, 'NO_ALL_BUILDS_JOB_ALREADY_RAN');
});

test('shouldSkip treats only a non-empty sentinel as already-ran', () => {
	assert.equal(shouldSkip(undefined), false);
	assert.equal(shouldSkip(''), false); // empty string = absent (the dogfood harness resets with `NO_ALL_BUILDS_JOB_ALREADY_RAN=`)
	assert.equal(shouldSkip('1'), true);
	assert.equal(shouldSkip('true'), true); // any non-empty value counts
});

test('isShadowJobName matches the guarded name in every rendered form', () => {
	const positives = [
		'all-builds',
		'all-builds (ubuntu-latest)',
		'all-builds (a, b)',
		'ci / all-builds',
		'ci / all-builds (x)',
		'all-builds / deploy',
		'  all-builds  '
	];
	for (const name of positives) {
		assert.equal(isShadowJobName(name), true, `expected match: '${name}'`);
	}
});

test('isShadowJobName does not match different names', () => {
	const negatives = [
		'all-builds-check',
		'my-all-builds',
		'allbuilds',
		'All-Builds', // case-sensitive on purpose: a different name cannot shadow the gate's UI entry
		'build',
		'ci / all-builds2'
	];
	for (const name of negatives) {
		assert.equal(isShadowJobName(name), false, `expected no match: '${name}'`);
	}
});

test('findJobViolations picks only shadow-named jobs and carries workflow/url', () => {
	const violations = findJobViolations([
		{name: 'build', workflow_name: 'CI', html_url: 'https://example.test/build'},
		{name: 'all-builds', workflow_name: 'CI', html_url: 'https://example.test/all-builds'},
		{name: 'all-builds (ubuntu-latest)'},
		{name: 'all-builds-check', workflow_name: 'CI'}
	]);
	assert.deepEqual(violations, [
		{jobName: 'all-builds', workflowName: 'CI', url: 'https://example.test/all-builds'},
		{jobName: 'all-builds (ubuntu-latest)', workflowName: '', url: ''}
	]);
});

test('findCheckRunViolations exempts only required-builds-manager', () => {
	const violations = findCheckRunViolations([
		// The app that OWNS the name — exempt.
		{name: 'all-builds', app: {id: REQUIRED_BUILDS_MANAGER_APP_ID, slug: 'required-builds-manager'}},
		// GitHub Actions' app (a workflow job's check run) — flagged.
		{name: 'all-builds', app: {id: 15368, slug: 'github-actions'}, html_url: 'https://example.test/run'},
		// Missing/null app is NOT excluded — flagged.
		{name: 'all-builds'},
		{name: 'all-builds (x)', app: null, details_url: 'https://example.test/details'},
		// Non-matching names never flag, regardless of app.
		{name: 'build', app: {id: 15368, slug: 'github-actions'}}
	]);
	assert.deepEqual(violations, [
		{name: 'all-builds', appSlug: 'github-actions', url: 'https://example.test/run'},
		{name: 'all-builds', appSlug: '', url: ''},
		{name: 'all-builds (x)', appSlug: '', url: 'https://example.test/details'}
	]);
});

test('scanWorkflowYaml flags the job key form', () => {
	const yaml = [
		'name: CI',
		'on:',
		'  push:',
		'jobs:',
		'  all-builds:',
		'    runs-on: ubuntu-latest',
		'    steps:',
		'      - run: echo shadow',
		'  build:',
		'    runs-on: ubuntu-latest'
	].join('\n');
	assert.deepEqual(scanWorkflowYaml('ci.yml', yaml), [{file: 'ci.yml', jobKey: 'all-builds', via: 'key'}]);
});

test('scanWorkflowYaml flags a bare all-builds job key with no body', () => {
	assert.deepEqual(scanWorkflowYaml('ci.yml', 'jobs:\n  all-builds:\n'), [{file: 'ci.yml', jobKey: 'all-builds', via: 'key'}]);
});

test('scanWorkflowYaml flags the display-name form', () => {
	const yaml = [
		'jobs:',
		'  publish:',
		'    name: all-builds',
		'    runs-on: ubuntu-latest'
	].join('\n');
	assert.deepEqual(scanWorkflowYaml('ci.yml', yaml), [{file: 'ci.yml', jobKey: 'publish', via: 'name'}]);
});

test('scanWorkflowYaml ignores expression names', () => {
	const yaml = [
		'jobs:',
		'  publish:',
		'    name: ${{ matrix.x }}',
		'    runs-on: ubuntu-latest'
	].join('\n');
	assert.deepEqual(scanWorkflowYaml('ci.yml', yaml), []);
});

test('scanWorkflowYaml is case-sensitive on display names', () => {
	const yaml = [
		'jobs:',
		'  publish:',
		'    name: All-Builds',
		'    runs-on: ubuntu-latest'
	].join('\n');
	assert.deepEqual(scanWorkflowYaml('ci.yml', yaml), []);
});

test('scanWorkflowYaml returns no findings for malformed or foreign YAML', () => {
	assert.deepEqual(scanWorkflowYaml('bad.yml', '{{{{not yaml'), []);
	assert.deepEqual(scanWorkflowYaml('bad.yml', 'a:\n\tb: c'), []); // tabs are a YAML parse error
	assert.deepEqual(scanWorkflowYaml('empty.yml', ''), []);
	assert.deepEqual(scanWorkflowYaml('scalar.yml', 'just a string'), []);
	assert.deepEqual(scanWorkflowYaml('list.yml', '- a\n- b'), []);
	assert.deepEqual(scanWorkflowYaml('no-jobs.yml', 'name: CI\nfoo: bar'), []);
});

test('scanWorkflowYaml returns no findings when jobs is not a map', () => {
	assert.deepEqual(scanWorkflowYaml('ci.yml', 'jobs: [a, b]'), []);
	assert.deepEqual(scanWorkflowYaml('ci.yml', 'jobs: 42'), []);
	assert.deepEqual(scanWorkflowYaml('ci.yml', 'jobs:'), []);
});

test('formatViolation carries the operator-mandated wording', () => {
	const message = formatViolation('Job "all-builds" in workflow "CI"', 'https://example.test/job');
	assert.ok(message.startsWith('Job "all-builds" in workflow "CI" is named all-builds.'));
	assert.ok(message.includes('known deception attempt'));
	assert.ok(message.includes('required-builds-manager'));
	assert.ok(message.includes('Rename'));
	assert.ok(message.includes('do not try to work around this check'));
	assert.ok(message.endsWith(' https://example.test/job'));
	// Without a URL the message just ends with the wording.
	assert.ok(formatViolation('Job key "all-builds" in workflow file "ci.yml"').endsWith('do not try to work around this check.'));
});
