import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	DEFAULTS,
	failureReport,
	hasFailures,
	isSkippableLine,
	lintFiles,
	lintText,
	nounRuns,
	sentences,
	stripCode,
	stripMarkup,
	stripQuotedSpans,
	wordCount,
} from './lint';

const words = (n: number) => Array.from({length: n}, (_, i) => `word${i}`).join(' ') + '.';

test('a sentence over the hard cap fails', () => {
	const f = lintText('a.md', words(26));
	assert.equal(f.hardLong.length, 1);
	assert.match(f.hardLong[0], /^a\.md:1: 26 words/);
	assert.equal(hasFailures(f), true);
});

test('a sentence between the caps only warns', () => {
	const f = lintText('a.md', words(22));
	assert.equal(f.hardLong.length, 0);
	assert.equal(f.warnLong.length, 1);
	assert.equal(hasFailures(f), false);
});

test('a sentence at the cap passes', () => {
	const f = lintText('a.md', words(25));
	assert.equal(f.hardLong.length, 0);
	assert.equal(f.warnLong.length, 1);
});

test('the caps are configurable', () => {
	const f = lintText('a.md', words(12), {hardMaxWords: 10, warnMaxWords: 5});
	assert.equal(f.hardLong.length, 1);
});

test('contractions fail, and every finding names its line', () => {
	const f = lintText('a.md', 'Line one.\nIt is fine.\nThat cannot work.\nIt is not what it should be.');
	assert.deepEqual(f.contractions, []);

	const g = lintText('b.md', 'first\nIt does not work.\nThat is fine.');
	assert.deepEqual(g.contractions, []);

	const h = lintText('c.md', "one\ntwo\nIt doesn't work.");
	assert.deepEqual(h.contractions, ['c.md:3: "doesn\'t"']);
});

test('should and shall fail because STE says must', () => {
	const f = lintText('a.md', 'You should run it.\nIt shall be run.');
	assert.equal(f.shouldShall.length, 2);
	assert.match(f.shouldShall[0], /a\.md:1: "should"/);
	assert.match(f.shouldShall[1], /a\.md:2: "shall"/);
});

test('a fenced block is exempt and does not shift line numbers', () => {
	const text = ['Intro.', '```', "it doesn't matter here", '```', "It doesn't matter here."].join('\n');
	const f = lintText('a.md', text);
	assert.equal(f.contractions.length, 1);
	assert.match(f.contractions[0], /a\.md:5:/);
});

test('inline code is exempt', () => {
	assert.equal(lintText('a.md', 'Run `it doesn\'t` now.').contractions.length, 0);
});

test('a quotation is exempt because it is another voice', () => {
	assert.equal(lintText('a.md', 'The owner said "it doesn\'t work".').contractions.length, 0);
	assert.equal(lintText('a.md', `The rule is "${words(40)}".`).hardLong.length, 0);
});

test('a heading, a blockquote and a table row are not sentences', () => {
	assert.equal(isSkippableLine('# A heading'), true);
	assert.equal(isSkippableLine('> quoted'), true);
	assert.equal(isSkippableLine('| a | b |'), true);
	assert.equal(isSkippableLine('Ordinary prose.'), false);
	assert.equal(lintText('a.md', `# ${words(40)}`).hardLong.length, 0);
});

test('a list marker and a link do not count as words', () => {
	assert.equal(stripMarkup('- A [linked](http://x) item'), 'A linked item');
	assert.equal(stripMarkup('1. **Bold** item'), 'Bold item');
});

test('sentences split on terminal punctuation', () => {
	assert.deepEqual(sentences('One thing. Two things! Three?'), ['One thing.', 'Two things!', 'Three?']);
	assert.equal(wordCount('One thing --- here.'), 3);
});

test('a run of four content words is a noun cluster', () => {
	assert.deepEqual(nounRuns('the upload session finalize integrity check'), ['upload session finalize integrity check']);
	assert.deepEqual(nounRuns('the integrity check on the finalize'), []);
});

test('passive voice warns and never fails', () => {
	const f = lintText('a.md', 'The file is deleted by the hook.');
	assert.equal(f.passive.length, 1);
	assert.equal(hasFailures(f), false);
});

test('stripCode and stripQuotedSpans keep the line count', () => {
	const text = 'a\n```\nb\n```\nc';
	assert.equal(stripCode(text).split('\n').length, text.split('\n').length);
	const quoted = 'x "a\nb" y';
	assert.equal(stripQuotedSpans(quoted).split('\n').length, 2);
});

test('lintFiles accumulates across files', () => {
	const f = lintFiles([
		{name: 'a.md', text: 'You should go.'},
		{name: 'b.md', text: 'You shall go.'},
	]);
	assert.equal(f.shouldShall.length, 2);
	assert.match(f.shouldShall[0], /^a\.md/);
	assert.match(f.shouldShall[1], /^b\.md/);
});

test('the failure report names every failing category and no warning', () => {
	const f = lintFiles([{name: 'a.md', text: `You should run it. It doesn't work. ${words(30)}`}]);
	const report = failureReport(f, DEFAULTS);
	assert.match(report, /Sentences over 25 words/);
	assert.match(report, /Contractions are banned/);
	assert.match(report, /never "should"\/"shall"/);
	assert.doesNotMatch(report, /passive/i);
});

test('clean prose reports nothing', () => {
	const f = lintText('a.md', '# Title\n\nThe hook reads the file. It writes the result.\n');
	assert.equal(hasFailures(f), false);
	assert.equal(failureReport(f, DEFAULTS), '');
	assert.equal(f.warnLong.length, 0);
});
