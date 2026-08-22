import assert from 'node:assert/strict';
import {test} from 'node:test';
import {blocks, lineAt} from './blocks';
import {lintText, sentenceBefore} from './lint';

const lines = (s: string) => s.split('\n');

test('a paragraph becomes one block, and every line maps back', () => {
	const [b] = blocks(lines('one two\nthree four\nfive six'));
	assert.equal(b.text, 'one two three four five six');
	assert.equal(b.startLine, 1);
	assert.equal(lineAt(b, 0), 1);
	assert.equal(lineAt(b, 8), 2);
	assert.equal(lineAt(b, 20), 3);
});

test('a blank line, a heading, a quote and a table row each end a block', () => {
	assert.equal(blocks(lines('a\n\nb')).length, 2);
	assert.equal(blocks(lines('a\n# h\nb')).length, 2);
	assert.equal(blocks(lines('a\n> q\nb')).length, 2);
	assert.equal(blocks(lines('a\n| c |\nb')).length, 2);
});

test('each list item is its own block, and its continuation stays with it', () => {
	const b = blocks(lines('- first item\n  continues here\n- second item'));
	assert.equal(b.length, 2);
	assert.equal(b[0].text, 'first item continues here');
	assert.equal(b[0].list, true);
	assert.equal(b[1].text, 'second item');
});

// The loophole this closes: prose is hard-wrapped, so measuring one physical
// line at a time made the sentence cap unenforceable.
test('a sentence wrapped over three lines is measured whole', () => {
	const wrapped = 'A sentence that runs past the cap because it keeps\ngoing well beyond what any reader can hold in\none breath, and then it carries on even further too.';
	const f = lintText('a.md', wrapped);
	assert.equal(f.hardLong.length, 1);
	assert.match(f.hardLong[0], /^a\.md:1: 2[6-9] words/);
});

test('a finding names the line its sentence starts on, not the block', () => {
	const f = lintText('a.md', 'Short one.\nShort two.\nThis line would fail.');
	assert.deepEqual(f.bannedModals, ['a.md:3: "would"']);
});

test('a banned tense split across a wrap is caught', () => {
	const f = lintText('a.md', 'The value has\nbeen replaced by the loader.');
	assert.equal(f.complexTense.length, 1);
	assert.match(f.complexTense[0], /a\.md:1: "has been"/);
});

test('a comma joining two clauses fails, the same as the semicolon it replaces', () => {
	const f = lintText('a.md', 'The queue is a display, it never takes focus.');
	assert.equal(f.commaSplices.length, 1);
	assert.match(f.commaSplices[0], /a\.md:1: ", it never takes"/);

	const g = lintText('b.md', 'The queue is a display, and it never takes focus.');
	assert.equal(g.commaSplices.length, 1);
});

test('an introductory phrase before a clause is not a comma splice', () => {
	for (const clean of [
		'Under the alt screen, there is no scrollback to select from.',
		'In that case, the answer is no.',
		'The card shows a model, a theme, and a diff.',
		'On a resize, a reflow is queued.',
	]) {
		assert.deepEqual(lintText('a.md', clean).commaSplices, [], clean);
	}
});

test('sentenceBefore returns the clause the comma follows', () => {
	assert.equal(sentenceBefore('One is done. Two is next, and three', 30), 'Two is next, and ');
	assert.equal(sentenceBefore('Only one clause here', 9), 'Only one ');
});
