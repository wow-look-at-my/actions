"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectations = expectations;
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const lint_1 = require("./lint");
const DIR = (0, node_path_1.join)(__dirname, '..', 'fixtures');
const HEADER = /^<!--\s*expect:\s*(.*?)\s*-->/;
// A fixture names the counts and nothing else, so a rule it says nothing about
// is free to change. The named ones are the reason the file is here.
function expectations(text) {
    const first = text.split('\n')[0] ?? '';
    const m = HEADER.exec(first);
    if (m === null)
        throw new Error('no "<!-- expect: ... -->" header on the first line');
    const out = {};
    for (const pair of m[1].split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq < 1)
            throw new Error(`"${pair}" is not name=count`);
        const name = pair.slice(0, eq);
        const n = Number(pair.slice(eq + 1));
        if (!Number.isInteger(n) || n < 0)
            throw new Error(`"${pair}" has no whole-number count`);
        if (!(name in (0, lint_1.emptyFindings)()))
            throw new Error(`"${name}" is not a rule this checker reports`);
        out[name] = n;
    }
    if (Object.keys(out).length === 0)
        throw new Error('the expect header names no rule');
    return out;
}
const files = (0, node_fs_1.readdirSync)(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
(0, node_test_1.test)('there are fixtures to walk', () => {
    node_assert_1.strict.ok(files.length > 0, `no fixtures in ${DIR}`);
});
for (const file of files) {
    (0, node_test_1.test)(`fixture ${file}`, () => {
        const text = (0, node_fs_1.readFileSync)((0, node_path_1.join)(DIR, file), 'utf8');
        const want = expectations(text);
        const got = (0, lint_1.lintText)(file, text, lint_1.DEFAULTS);
        for (const [name, count] of Object.entries(want)) {
            node_assert_1.strict.equal(got[name].length, count, `${name}: ${JSON.stringify(got[name])}`);
        }
    });
}
(0, node_test_1.test)('a fixture with no expect header fails the run', () => {
    node_assert_1.strict.throws(() => expectations('# nothing\n'), /expect/);
});
(0, node_test_1.test)('an expect header naming an unknown rule fails the run', () => {
    node_assert_1.strict.throws(() => expectations('<!-- expect: elbows=1 -->\n'), /not a rule/);
});
(0, node_test_1.test)('every failing rule is named by at least one fixture', () => {
    const named = new Set();
    for (const file of files) {
        for (const rule of Object.keys(expectations((0, node_fs_1.readFileSync)((0, node_path_1.join)(DIR, file), 'utf8'))))
            named.add(rule);
    }
    const failing = [
        'hardLong',
        'contractions',
        'bannedModals',
        'semicolons',
        'commaSplices',
        'wrappedLines',
    ];
    for (const rule of failing) {
        node_assert_1.strict.ok(named.has(rule), `no fixture asserts on ${rule}`);
    }
});
