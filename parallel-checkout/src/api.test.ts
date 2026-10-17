import * as assert from 'assert';
import {test} from 'node:test';
import {pickHead} from './plan';
import {headLister, treeFromApi} from './api';

const entries = [
	{path: '.gitmodules', mode: '100644', type: 'blob', sha: 'aaa'},
	{path: 'src/vendor/x', mode: '160000', type: 'commit', sha: '9beb694f9766a2c69fe6c89cfa6cf653a32b5a27'},
	{path: 'src', mode: '040000', type: 'tree', sha: 'bbb'},
];

test('gitlinks come out of a trees answer and the rest does not', () => {
	const tree = treeFromApi({tree: entries, truncated: false}, '[submodule "x"]\n');
	assert.deepStrictEqual([...tree!.links], [['src/vendor/x', '9beb694f9766a2c69fe6c89cfa6cf653a32b5a27']]);
	assert.strictEqual(tree!.gitmodules, '[submodule "x"]\n');
});

test('a truncated answer is no answer', () => {
	assert.strictEqual(treeFromApi({tree: entries, truncated: true}, ''), undefined);
});

test('one GraphQL request answers every head asked for in one turn, in the form pickHead reads', async () => {
	const bodies: string[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init: {body: string}) => {
		bodies.push(init.body);
		const data = {
			r0: {defaultBranchRef: {name: 'main', target: {oid: 'a'.repeat(40)}}, h0: {target: {oid: 'b'.repeat(40)}}},
			r1: {defaultBranchRef: {name: 'master', target: {oid: 'c'.repeat(40)}}, h0: null},
			r2: null,
		};
		return new Response(JSON.stringify({data}), {status: 200});
	}) as typeof fetch;
	try {
		const list = headLister({apiUrl: 'https://api.example', server: 'https://example', token: 't', log: () => undefined});
		const [one, two, gone, foreign] = await Promise.all([
			list('https://example/o/one', ['refs/heads/feature']),
			list('https://example/o/two.git', ['refs/heads/feature']),
			list('https://example/o/gone', ['refs/heads/feature']),
			list('https://elsewhere/o/x', ['refs/heads/feature']),
		]);
		assert.strictEqual(bodies.length, 1);
		assert.match(bodies[0], /name: \\"two\\"/);
		assert.deepStrictEqual(pickHead('feature', '', one!), {branch: 'feature', sha: 'b'.repeat(40)});
		assert.deepStrictEqual(pickHead('feature', '', two!), {branch: 'master', sha: 'c'.repeat(40)});
		assert.strictEqual(gone, undefined);
		assert.strictEqual(foreign, undefined);
	} finally {
		globalThis.fetch = real;
	}
});

test('a failed GraphQL request answers undefined, so git lists the remote', async () => {
	const real = globalThis.fetch;
	globalThis.fetch = (async () => new Response('', {status: 502})) as typeof fetch;
	try {
		const log: string[] = [];
		const list = headLister({apiUrl: 'https://api.example', server: 'https://example', token: 't', log: line => log.push(line)});
		assert.strictEqual(await list('https://example/o/one', ['refs/heads/feature']), undefined);
		assert.ok(log.some(line => line.includes('502')), log.join('\n'));
	} finally {
		globalThis.fetch = real;
	}
});
