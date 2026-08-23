"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const blocks_1 = require("./blocks");
const lint_1 = require("./lint");
const lines = (s) => s.split('\n');
(0, node_test_1.test)('a paragraph becomes one block, and every line maps back', () => {
    const [b] = (0, blocks_1.blocks)(lines('one two\nthree four\nfive six'));
    strict_1.default.equal(b.text, 'one two three four five six');
    strict_1.default.equal(b.startLine, 1);
    strict_1.default.equal((0, blocks_1.lineAt)(b, 0), 1);
    strict_1.default.equal((0, blocks_1.lineAt)(b, 8), 2);
    strict_1.default.equal((0, blocks_1.lineAt)(b, 20), 3);
});
(0, node_test_1.test)('a blank line, a heading, a quote and a table row each end a block', () => {
    strict_1.default.equal((0, blocks_1.blocks)(lines('a\n\nb')).length, 2);
    strict_1.default.equal((0, blocks_1.blocks)(lines('a\n# h\nb')).length, 2);
    strict_1.default.equal((0, blocks_1.blocks)(lines('a\n> q\nb')).length, 2);
    strict_1.default.equal((0, blocks_1.blocks)(lines('a\n| c |\nb')).length, 2);
});
(0, node_test_1.test)('each list item is its own block, and its continuation stays with it', () => {
    const b = (0, blocks_1.blocks)(lines('- first item\n  continues here\n- second item'));
    strict_1.default.equal(b.length, 2);
    strict_1.default.equal(b[0].text, 'first item continues here');
    strict_1.default.equal(b[0].list, true);
    strict_1.default.equal(b[1].text, 'second item');
});
// The loophole this closes: prose is hard-wrapped, so measuring one physical
// line at a time made the sentence cap unenforceable.
(0, node_test_1.test)('a sentence wrapped over three lines is measured whole', () => {
    const wrapped = 'A sentence that runs past the cap because it keeps\ngoing well beyond what any reader can hold in\none breath, and then it carries on even further too.';
    const f = (0, lint_1.lintText)('a.md', wrapped);
    strict_1.default.equal(f.hardLong.length, 1);
    strict_1.default.match(f.hardLong[0], /^a\.md:1: 2[6-9] words/);
});
(0, node_test_1.test)('a finding names the line its sentence starts on, not the block', () => {
    const f = (0, lint_1.lintText)('a.md', 'Short one.\nShort two.\nThis line would fail.');
    strict_1.default.deepEqual(f.bannedModals, ['a.md:3: "would"']);
});
(0, node_test_1.test)('a banned tense split across a wrap is caught', () => {
    const f = (0, lint_1.lintText)('a.md', 'The value has\nbeen replaced by the loader.');
    strict_1.default.equal(f.complexTense.length, 1);
    strict_1.default.match(f.complexTense[0], /a\.md:1: "has been"/);
});
(0, node_test_1.test)('a comma joining two clauses fails, the same as the semicolon it replaces', () => {
    const f = (0, lint_1.lintText)('a.md', 'The queue is a display, it never takes focus.');
    strict_1.default.equal(f.commaSplices.length, 1);
    strict_1.default.match(f.commaSplices[0], /a\.md:1: ", it never takes"/);
    const g = (0, lint_1.lintText)('b.md', 'The queue is a display, and it never takes focus.');
    strict_1.default.equal(g.commaSplices.length, 1);
});
(0, node_test_1.test)('an introductory phrase before a clause is not a comma splice', () => {
    for (const clean of [
        'Under the alt screen, there is no scrollback to select from.',
        'In that case, the answer is no.',
        'The card shows a model, a theme, and a diff.',
        'On a resize, a reflow is queued.',
    ]) {
        strict_1.default.deepEqual((0, lint_1.lintText)('a.md', clean).commaSplices, [], clean);
    }
});
(0, node_test_1.test)('clauseBefore stops at the nearest boundary, not the last full stop', () => {
    strict_1.default.equal((0, lint_1.clauseBefore)('One is done. Two is next and three', 29), 'Two is next and ');
    strict_1.default.equal((0, lint_1.clauseBefore)('Only one clause here', 9), 'Only one ');
    // The comma follows a phrase, and the clause before it is two boundaries back.
    strict_1.default.equal((0, lint_1.clauseBefore)('This matters: on a slow link, the diff', 28), 'on a slow link');
});
(0, node_test_1.test)('a comma after a subordinate clause is correct English, not a splice', () => {
    for (const clean of [
        'If a surface other than a terminal is wanted, it gets designed then.',
        'When the run ends and nothing is queued, the hook is dispatched.',
        'Because the value is unknown, it renders as a dash.',
        'While the read is in flight, the pane shows what it has.',
    ]) {
        strict_1.default.deepEqual((0, lint_1.lintText)('a.md', clean).commaSplices, [], clean);
    }
});
// A blanked span used to leave pure whitespace. A sentence that opened with a
// code span then lost its capital and never split from the one before it, and a
// technical name counted as zero words. Both made a sentence measure too long.
(0, node_test_1.test)('a code span counts as one word and can open a sentence', () => {
    strict_1.default.equal((0, lint_1.blankSpan)('`Foo.Bar`'), 'X        ');
    strict_1.default.equal((0, lint_1.wordCount)((0, lint_1.stripCode)('`a` `b` `c`')), 3);
    const f = (0, lint_1.lintText)('a.md', 'The order is fixed. `02-contracts.md` fixes it there, and nothing else does.');
    strict_1.default.deepEqual(f.hardLong, []);
});
(0, node_test_1.test)('a blanked span keeps its length, so a finding still names its line', () => {
    const f = (0, lint_1.lintText)('a.md', 'one\ntwo `code here`\nThis line would fail.');
    strict_1.default.deepEqual(f.bannedModals, ['a.md:3: "would"']);
});
// A sentence that opens with one of these used to join the sentence before it,
// and the pair then measured as one long sentence.
(0, node_test_1.test)('a sentence opens on a section sign, a quote or a non-ASCII capital', () => {
    for (const opener of ['§3a says so.', '"Quoted" is fine.', 'Ähnlich here.', '¶ 4 says so.']) {
        const f = (0, lint_1.lintText)('a.md', `First sentence here. ${opener}`);
        strict_1.default.deepEqual(f.hardLong, []);
        strict_1.default.equal((0, lint_1.sentences)(`First sentence here. ${opener}`).length, 2, opener);
    }
});
