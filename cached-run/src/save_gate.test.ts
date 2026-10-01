import * as assert from 'assert';
import {test} from 'node:test';
import {SAVE_ON_VALUES, parseSaveOn, saveGate} from './save_gate';

function env(over: Record<string, string | undefined> = {}) {
	return {
		SAVE_ON: '',
		GITHUB_REF: 'refs/heads/feature',
		DEFAULT_BRANCH: 'master',
		...over
	};
}

test('the default branch writes', () => {
	const gate = saveGate(env({GITHUB_REF: 'refs/heads/master'}));
	assert.strictEqual(gate.allowed, true);
	assert.strictEqual(gate.reason, '');
});

test('another branch reuses and writes nothing', () => {
	const gate = saveGate(env());
	assert.strictEqual(gate.allowed, false);
	assert.strictEqual(gate.isWarning, false);
	assert.match(gate.reason, /refs\/heads\/feature/);
});

test('the default is default-branch, so an unset input still gates', () => {
	assert.strictEqual(parseSaveOn(undefined), 'default-branch');
	assert.strictEqual(parseSaveOn(''), 'default-branch');
	assert.strictEqual(saveGate(env({SAVE_ON: undefined})).allowed, false);
});

test('save-on any writes from any ref', () => {
	assert.strictEqual(saveGate(env({SAVE_ON: 'any'})).allowed, true);
	assert.strictEqual(
		saveGate(env({SAVE_ON: 'any', GITHUB_REF: 'refs/pull/7/merge'})).allowed,
		true
	);
});

test('save-on any needs no default branch', () => {
	const gate = saveGate(env({SAVE_ON: 'any', DEFAULT_BRANCH: ''}));
	assert.strictEqual(gate.allowed, true);
});

test('a tag named after the default branch is not the default branch', () => {
	const gate = saveGate(env({GITHUB_REF: 'refs/tags/master'}));
	assert.strictEqual(gate.allowed, false);
});

test('a branch whose name merely starts with the default branch does not write', () => {
	const gate = saveGate(env({GITHUB_REF: 'refs/heads/master-backport'}));
	assert.strictEqual(gate.allowed, false);
});

test('a default branch that is not master is honored', () => {
	assert.strictEqual(
		saveGate(env({GITHUB_REF: 'refs/heads/main', DEFAULT_BRANCH: 'main'})).allowed,
		true
	);
	assert.strictEqual(
		saveGate(env({GITHUB_REF: 'refs/heads/master', DEFAULT_BRANCH: 'main'})).allowed,
		false
	);
});

test('a nested default branch name matches on the whole ref', () => {
	assert.strictEqual(
		saveGate(env({GITHUB_REF: 'refs/heads/release/v1', DEFAULT_BRANCH: 'release/v1'}))
			.allowed,
		true
	);
});

test('an unknown default branch refuses the write and says so', () => {
	const gate = saveGate(env({DEFAULT_BRANCH: ''}));
	assert.strictEqual(gate.allowed, false);
	assert.strictEqual(gate.isWarning, true);
	assert.match(gate.reason, /save-on: any/);
});

test('an unreadable save-on fails instead of picking a policy', () => {
	assert.throws(() => parseSaveOn('Default-Branch'), /not one of/);
	assert.throws(() => parseSaveOn('true'), /not one of/);
	assert.throws(() => saveGate(env({SAVE_ON: 'always'})), /not one of/);
});

test('the accepted values are the ones the README documents', () => {
	assert.deepStrictEqual(SAVE_ON_VALUES, ['default-branch', 'any']);
});
