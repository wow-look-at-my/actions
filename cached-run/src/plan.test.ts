import * as assert from 'assert';
import {test} from 'node:test';
import {plan, PlanEnv} from './plan';

function env(overrides: Partial<PlanEnv> = {}): PlanEnv {
	return {
		RUN_SCRIPT: 'make build',
		RAW_PATHS: 'build/',
		EXTRA_KEY: '',
		RUNNER_OS_NAME: 'Linux',
		RUNNER_ARCH_NAME: 'X64',
		RUNNER_TEMP: '/tmp',
		...overrides
	};
}

test('the key carries the action scheme and the platform', () => {
	assert.ok(plan(env()).key.startsWith('cached-run-v2-Linux-X64-'), plan(env()).key);
});

test('one script and one path list produce one key twice', () => {
	assert.strictEqual(plan(env()).key, plan(env()).key);
});

test('one changed character in the script changes the key', () => {
	assert.notStrictEqual(plan(env()).key, plan(env({RUN_SCRIPT: 'make build '})).key);
});

test('an added path changes the key, and a reorder does not', () => {
	const one = plan(env({RAW_PATHS: 'build/'})).key;
	const two = plan(env({RAW_PATHS: 'build/\ndist/'})).key;
	const flipped = plan(env({RAW_PATHS: 'dist/\nbuild/'})).key;
	assert.notStrictEqual(one, two);
	assert.strictEqual(two, flipped);
});

test('the paths are trimmed, deduplicated and sorted before the cache sees them', () => {
	assert.deepStrictEqual(plan(env({RAW_PATHS: '  dist/  \n\nbuild/\ndist/\n'})).paths, ['build/', 'dist/']);
});

test('an empty paths input fails loudly instead of caching nothing quietly', () => {
	assert.throws(() => plan(env({RAW_PATHS: '   '})), /paths input is empty/);
});

test('an empty run input fails loudly, because a composite does not enforce required', () => {
	assert.throws(() => plan(env({RUN_SCRIPT: '   '})), /run input is empty/);
});

test('a missing platform fails rather than keying every runner the same', () => {
	assert.throws(() => plan(env({RUNNER_ARCH_NAME: ''})), /RUNNER_ARCH_NAME/);
});

test('the sentinel sits under RUNNER_TEMP and names the digest', () => {
	const result = plan(env({RUNNER_TEMP: '/runner/tmp'}));
	assert.strictEqual(result.sentinel, `/runner/tmp/cached-run-${result.digest}.done`);
});

test('two calls in one job get two sentinels', () => {
	assert.notStrictEqual(plan(env()).sentinel, plan(env({RUN_SCRIPT: 'make test'})).sentinel);
});

test('the environment a run exports is cached beside the paths it produced', () => {
	const result = plan(env({RUNNER_TEMP: '/runner/tmp', RAW_PATHS: 'dist/'}));
	assert.strictEqual(result.envDir, `/runner/tmp/cached-run-${result.digest}.env`);
	assert.deepStrictEqual(result.cachePaths, ['dist/', result.envDir]);
});

// The caller's own paths decide what a hit means. Keying on the action's
// directory too would move every key for a reason no caller asked for.
test('the environment directory is not in the key', () => {
	const result = plan(env({RUNNER_TEMP: '/runner/tmp'}));
	const elsewhere = plan(env({RUNNER_TEMP: '/somewhere/else'}));
	assert.strictEqual(result.key, elsewhere.key);
	assert.notStrictEqual(result.envDir, elsewhere.envDir);
});

test('the extra key separates two callers running the identical script', () => {
	const alpha = plan(env({EXTRA_KEY: 'alpha'}));
	const beta = plan(env({EXTRA_KEY: 'beta'}));
	assert.notStrictEqual(alpha.key, beta.key);
	assert.ok(alpha.key.includes('-alpha-'), alpha.key);
});

test('a key label holding characters a cache key rejects is sanitized', () => {
	const key = plan(env({EXTRA_KEY: 'node, v22 / ubuntu'})).key;
	assert.ok(!key.includes(','), key);
	assert.ok(!key.includes(' '), key);
});
