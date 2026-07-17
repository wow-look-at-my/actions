import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMissVerdict, missingNameMessage, rejectUnsupportedInputs, repoMismatchMessage} from './lib';
import {buildCacheKey, CacheEntry, expectedCacheVersions} from './shared';

test('rejectUnsupportedInputs: nothing set passes, each unsupported input is named', () => {
	assert.equal(rejectUnsupportedInputs({pattern: '', mergeMultiple: false, artifactIds: ''}), undefined);
	const one = rejectUnsupportedInputs({pattern: 'x-*', mergeMultiple: false, artifactIds: ''});
	assert.match(one as string, /input pattern is not supported/);
	const all = rejectUnsupportedInputs({pattern: 'x-*', mergeMultiple: true, artifactIds: '1,2'});
	assert.match(all as string, /pattern, merge-multiple, artifact-ids/);
	assert.match(all as string, /are not supported/);
	assert.match(all as string, /explicit name/);
});

test('repoMismatchMessage names both repos and the scoping rule', () => {
	const msg = repoMismatchMessage('other/repo', 'wow-look-at-my/actions');
	assert.match(msg, /repo-scoped/);
	assert.match(msg, /other\/repo/);
	assert.match(msg, /wow-look-at-my\/actions/);
});

test('missingNameMessage explains the no-download-all limitation', () => {
	const msg = missingNameMessage();
	assert.match(msg, /explicit artifact name/);
	assert.match(msg, /not supported/);
});

function entry(overrides: Partial<CacheEntry>): CacheEntry {
	return {
		id: 1,
		ref: 'refs/heads/master',
		key: 'ghart-v1-100-aaaaaaaaaaaaaaaa-a1-x',
		version: expectedCacheVersions()[0],
		created_at: '2026-07-17T00:00:00Z',
		size_in_bytes: 2048,
		...overrides
	};
}

const base = {
	name: 'build-output',
	exactKey: buildCacheKey('100', '1', 'build-output'),
	runId: '100',
	currentRef: 'refs/heads/claude/feature'
};

test('miss verdict: entry on a foreign ref means branch scoping', () => {
	const msg = buildMissVerdict({
		...base,
		entriesForKey: [entry({ref: 'refs/heads/other-branch'})],
		runEntries: [],
		usage: undefined
	});
	assert.match(msg, /branch-scoped/);
	assert.match(msg, /refs\/heads\/other-branch/);
	assert.match(msg, /refs\/heads\/claude\/feature/);
});

test('miss verdict: entry on our own ref with an expected version means transient failure', () => {
	const msg = buildMissVerdict({
		...base,
		entriesForKey: [entry({ref: base.currentRef})],
		runEntries: [],
		usage: undefined
	});
	assert.match(msg, /should have hit/);
	assert.match(msg, /re-run/);
});

test('miss verdict: entry on our own ref with an unexpected version means a broken contract', () => {
	const msg = buildMissVerdict({
		...base,
		entriesForKey: [entry({ref: base.currentRef, version: 'f'.repeat(64)})],
		runEntries: [],
		usage: undefined
	});
	assert.match(msg, /unexpected cache version/);
	assert.match(msg, /payload paths or compression/);
});

test('miss verdict: other keys saved by the run means a name mismatch', () => {
	const otherKey = buildCacheKey('100', '1', 'build-otuput');
	const msg = buildMissVerdict({
		...base,
		entriesForKey: [],
		runEntries: [entry({key: otherKey})],
		usage: undefined
	});
	assert.match(msg, /never saved by run 100/);
	assert.ok(msg.includes(otherKey));
	assert.match(msg, /name mismatch or typo/);
});

test('miss verdict: nothing saved at all names the upload step, with the eviction hint when usage is known', () => {
	const withoutUsage = buildMissVerdict({...base, entriesForKey: [], runEntries: [], usage: undefined});
	assert.match(withoutUsage, /upload step did not run, failed/);
	assert.ok(!withoutUsage.includes('LRU-evicted'));
	const withUsage = buildMissVerdict({
		...base,
		entriesForKey: [],
		runEntries: [],
		usage: {active_caches_count: 900, active_caches_size_in_bytes: 9.9e9}
	});
	assert.match(withUsage, /9.90 GB/);
	assert.match(withUsage, /LRU-evicted/);
});

test('miss verdict: REST fully unavailable degrades to the generic checklist', () => {
	const msg = buildMissVerdict({...base, entriesForKey: undefined, runEntries: undefined, usage: undefined});
	assert.match(msg, /diagnosis was unavailable/);
	assert.match(msg, /actions: read/);
	assert.match(msg, /branch-scoped/);
});

test('every verdict carries the exact key', () => {
	for (const ctx of [
		{...base, entriesForKey: [entry({})], runEntries: [], usage: undefined},
		{...base, entriesForKey: [], runEntries: [entry({})], usage: undefined},
		{...base, entriesForKey: [], runEntries: [], usage: undefined},
		{...base, entriesForKey: undefined, runEntries: undefined, usage: undefined}
	]) {
		assert.ok(buildMissVerdict(ctx).includes(base.exactKey));
	}
});
