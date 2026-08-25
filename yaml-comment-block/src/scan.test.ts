import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_COMMENT_LINES, candidatePaths, findCommentBlocks, findUses, formatBlock, isLocalRef} from './scan';

test('the limit is one comment line', () => {
	assert.equal(MAX_COMMENT_LINES, 1);
});

test('one comment line passes, two fail', () => {
	assert.deepEqual(findCommentBlocks('# one\njobs: {}\n'), []);
	assert.deepEqual(findCommentBlocks('# one\n# two\njobs: {}\n'), [{startLine: 1, endLine: 2, lines: 2}]);
});

test('a block reports its full span', () => {
	const content = ['name: CI', '# one', '# two', '# three', '# four', '# five', 'jobs: {}'].join('\n');
	assert.deepEqual(findCommentBlocks(content), [{startLine: 2, endLine: 6, lines: 5}]);
});

test('each block is reported separately', () => {
	const content = ['# a', '# b', '# c', '# d', 'name: CI', '# e', '# f', '# g', '# h', 'jobs: {}'].join('\n');
	assert.deepEqual(findCommentBlocks(content), [
		{startLine: 1, endLine: 4, lines: 4},
		{startLine: 6, endLine: 9, lines: 4}
	]);
});

test('a line of content splits a block', () => {
	const content = ['# a', 'name: CI', '# b', 'on: push', '# c', 'jobs: {}'].join('\n');
	assert.deepEqual(findCommentBlocks(content), []);
});

test('blank lines neither count nor split a block', () => {
	const content = ['# a', '# b', '', '# c', '', '# d', 'jobs: {}'].join('\n');
	assert.deepEqual(findCommentBlocks(content), [{startLine: 1, endLine: 6, lines: 4}]);
});

test('a trailing comment after content never joins a block', () => {
	const content = ['# a', 'name: CI # two', 'on: push # three', '# b', 'jobs: {}'].join('\n');
	assert.deepEqual(findCommentBlocks(content), []);
});

test('an indented comment wall counts, including one inside a run: script', () => {
	const content = ['jobs:', '  build:', '    steps:', '      - run: |', '          # one', '          # two', '          # three', '          # four', '          echo hi'].join('\n');
	assert.deepEqual(findCommentBlocks(content), [{startLine: 5, endLine: 8, lines: 4}]);
});

test('a block that ends the file is reported', () => {
	assert.deepEqual(findCommentBlocks('name: CI\n# a\n# b\n# c\n# d\n'), [{startLine: 2, endLine: 5, lines: 4}]);
});

test('CRLF line endings are handled', () => {
	assert.deepEqual(findCommentBlocks('# a\r\n# b\r\n# c\r\n# d\r\njobs: {}\r\n'), [{startLine: 1, endLine: 4, lines: 4}]);
});

test('an empty file has no blocks', () => {
	assert.deepEqual(findCommentBlocks(''), []);
});

test('findUses reads every uses: form with its line number', () => {
	const content = [
		'jobs:',
		'  build:',
		'    steps:',
		'      - uses: actions/checkout@v4',
		"      - uses: './local-action'",
		'      - name: quoted',
		'        uses: "wow-look-at-my/actions@typescript#latest"',
		'      - uses: ./other # trailing comment',
		'      - uses: wow-look-at-my/actions@typescript#latest',
		'  call:',
		'    uses: ./.github/workflows/reusable.yml'
	].join('\n');
	assert.deepEqual(findUses(content), [
		{value: 'actions/checkout@v4', line: 4},
		{value: './local-action', line: 5},
		{value: 'wow-look-at-my/actions@typescript#latest', line: 7},
		{value: './other', line: 8},
		{value: 'wow-look-at-my/actions@typescript#latest', line: 9},
		{value: './.github/workflows/reusable.yml', line: 11}
	]);
});

test('findUses ignores a commented-out uses line', () => {
	assert.deepEqual(findUses('      # - uses: actions/checkout@v4'), []);
});

test('isLocalRef separates this repository from every other one', () => {
	assert.equal(isLocalRef('./typescript'), true);
	assert.equal(isLocalRef('./.github/workflows/release.yml'), true);
	assert.equal(isLocalRef('actions/checkout@v4'), false);
	assert.equal(isLocalRef('wow-look-at-my/actions@typescript#latest'), false);
	assert.equal(isLocalRef('docker://alpine:3'), false);
});

test('candidatePaths names the action file for a directory and the file itself for a workflow', () => {
	assert.deepEqual(candidatePaths('./typescript'), ['typescript/action.yml', 'typescript/action.yaml']);
	assert.deepEqual(candidatePaths('./.github/actions/setup-and-build'), ['.github/actions/setup-and-build/action.yml', '.github/actions/setup-and-build/action.yaml']);
	assert.deepEqual(candidatePaths('./.github/workflows/publish-ghcr.yml'), ['.github/workflows/publish-ghcr.yml']);
});

test('formatBlock names the file, the count, the span and the limit', () => {
	const message = formatBlock('.github/workflows/ci.yml', {startLine: 3, endLine: 9, lines: 6});
	assert.match(message, /^\.github\/workflows\/ci\.yml: 6 comment lines in a row \(lines 3-9\) — the limit is 1\./);
	assert.match(message, /Shorten this to one line/);
});
