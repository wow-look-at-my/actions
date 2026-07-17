import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	chooseSaveFailureDiagnosis,
	noFilesMessage,
	parseNoFilesBehavior,
	readOnlyCacheMessage,
	validateArtifactName,
	validateFilePath
} from './lib';
import {CacheEntry} from './shared';

test('validateArtifactName accepts sane names', () => {
	validateArtifactName('artifact');
	validateArtifactName('my artifact, with commas');
	validateArtifactName('release-snapshot_v2.1');
});

test('validateArtifactName rejects each upstream-forbidden character and the empty name', () => {
	assert.throws(() => validateArtifactName(''), /empty/);
	for (const bad of ['"', ':', '<', '>', '|', '*', '?', '\r', '\n', '\\', '/']) {
		assert.throws(() => validateArtifactName(`a${bad}b`), /not valid/, `expected ${JSON.stringify(bad)} to be rejected`);
	}
});

test('validateFilePath allows slashes but rejects the shared forbidden set', () => {
	validateFilePath('sub/dir/file.txt');
	for (const bad of ['"', ':', '<', '>', '|', '*', '?', '\r', '\n']) {
		assert.throws(() => validateFilePath(`a${bad}b`), /not valid/, `expected ${JSON.stringify(bad)} to be rejected`);
	}
});

test('parseNoFilesBehavior recognizes exactly warn/error/ignore', () => {
	assert.equal(parseNoFilesBehavior('warn'), 'warn');
	assert.equal(parseNoFilesBehavior('error'), 'error');
	assert.equal(parseNoFilesBehavior('ignore'), 'ignore');
	assert.equal(parseNoFilesBehavior(''), undefined);
	assert.equal(parseNoFilesBehavior('Warn'), undefined);
	assert.equal(parseNoFilesBehavior('nope'), undefined);
});

test('noFilesMessage matches the upstream text', () => {
	assert.equal(
		noFilesMessage('dist/**'),
		'No files were found with the provided path: dist/**. No artifacts will be uploaded.'
	);
});

test('readOnlyCacheMessage names the event and lists the writer events', () => {
	const msg = readOnlyCacheMessage('read', 'workflow_run');
	assert.match(msg, /ACTIONS_CACHE_MODE=read/);
	assert.match(msg, /event "workflow_run"/);
	assert.match(msg, /push, workflow_dispatch, repository_dispatch, delete, registry_package, page_build, schedule/);
});

function entry(overrides: Partial<CacheEntry>): CacheEntry {
	return {
		id: 1,
		ref: 'refs/heads/master',
		key: 'ghart-v1-1-aaaaaaaaaaaaaaaa-a1-x',
		version: 'v',
		created_at: '2026-07-17T00:00:00Z',
		size_in_bytes: 1024,
		...overrides
	};
}

test('save-failure diagnosis: existing entries mean an immutable duplicate key', () => {
	const msg = chooseSaveFailureDiagnosis({
		name: 'build-output',
		key: 'ghart-v1-1-aaaaaaaaaaaaaaaa-a1-build-output',
		entriesForKey: [entry({id: 42})],
		cacheMode: undefined,
		eventName: 'push',
		rawError: 'saveCache returned -1'
	});
	assert.match(msg, /already exists/);
	assert.match(msg, /immutable/);
	assert.match(msg, /unique per run/);
	assert.match(msg, /overwrite: true/);
	assert.match(msg, /id 42/);
});

test('save-failure diagnosis: read-only cache mode is named when no entry exists', () => {
	const msg = chooseSaveFailureDiagnosis({
		name: 'build-output',
		key: 'k',
		entriesForKey: [],
		cacheMode: 'read',
		eventName: 'workflow_run',
		rawError: 'saveCache returned -1'
	});
	assert.match(msg, /read-only/);
	assert.match(msg, /workflow_run/);
});

test('save-failure diagnosis: generic backend refusal carries the raw error', () => {
	const raw = 'Unable to reserve cache with key k, another job may be creating this cache.';
	for (const entriesForKey of [[], undefined]) {
		const msg = chooseSaveFailureDiagnosis({
			name: 'build-output',
			key: 'k',
			entriesForKey,
			cacheMode: undefined,
			eventName: 'push',
			rawError: raw
		});
		assert.match(msg, /refused the save/);
		assert.ok(msg.includes(raw));
	}
});
