import * as assert from 'assert';
import {test} from 'node:test';
import {treeFromApi} from './api';

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
