import * as assert from 'assert';
import {test} from 'node:test';
import {Fetch, lockName, runLock} from './runlock';

const run = {repository: 'o/r', runId: '7', runAttempt: '1'};

// store answers like buildhost's run lock endpoint, and fails the first `outages` requests with a 503.
function store(outages = 0) {
	const values = new Map<string, string>();
	const seen: string[] = [];
	const fetch: Fetch = async (url, init) => {
		seen.push(`${init.method} ${init.headers.Authorization}`);
		if (outages > 0) {
			outages--;
			return {status: 503, text: async () => 'busy'};
		}
		if (init.method === 'GET') {
			const name = new URL(url).searchParams.get('name')!;
			const value = values.get(name);
			return {status: 200, text: async () => JSON.stringify(value === undefined ? {found: false} : {found: true, value})};
		}
		const body = JSON.parse(init.body!) as {name: string; value: string};
		if (!values.has(body.name)) {
			values.set(body.name, body.value);
		}
		return {status: 200, text: async () => JSON.stringify({value: values.get(body.name)})};
	};
	return {fetch, seen};
}

test('the first head is locked and every later ask gets it back', async () => {
	const {fetch, seen} = store();
	const lock = runLock({store: 'https://pazer.build/', run, token: async audience => `tok:${audience}`, fetch, log: () => {}});
	assert.strictEqual(await lock('n', 'aaa'), 'aaa');
	assert.strictEqual(await lock('n', 'bbb'), 'aaa');
	assert.ok(seen.every(line => line.endsWith('Bearer tok:https://pazer.build')), seen.join('\n'));
});

test('a 5xx answer is tried again until the store answers', async () => {
	const {fetch} = store(2);
	const log: string[] = [];
	const lock = runLock({store: 'https://pazer.build', run, token: async () => 't', fetch, log: line => log.push(line), retryMs: 1});
	assert.strictEqual(await lock('n', 'aaa'), 'aaa');
	assert.strictEqual(log.length, 2);
	assert.match(log[0], /HTTP 503: busy; trying again in 0.001s$/);
});

test('a 4xx answer fails', async () => {
	const fetch: Fetch = async () => ({status: 403, text: async () => 'no'});
	const lock = runLock({store: 'https://pazer.build', run, token: async () => 't', fetch, log: () => {}});
	await assert.rejects(lock('n', 'aaa'), /HTTP 403: no/);
});

test('a lock name is the repository path and the branch', () => {
	assert.strictEqual(lockName('https://github.com/wow-look-at-my/gosmopolitan.git', 'master'), 'submodule:github.com/wow-look-at-my/gosmopolitan@master');
});
