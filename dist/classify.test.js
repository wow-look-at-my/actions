"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const classify_1 = require("./classify");
function ctx(overrides = {}) {
    return {
        actionDirs: new Set(['widget', 'a/b', '.github/actions/setup-and-build']),
        branches: new Set(['master', 'feature-branch', 'claude/session-bdZri']),
        currentBranch: 'master',
        defaultBranch: 'master',
        ...overrides,
    };
}
(0, node_test_1.test)('parseTag strips the ref prefix and peel suffix', () => {
    strict_1.default.deepEqual((0, classify_1.parseTag)('refs/tags/widget#1'), { tag: 'widget#1', name: 'widget', version: '1' });
    strict_1.default.deepEqual((0, classify_1.parseTag)('widget#latest'), { tag: 'widget#latest', name: 'widget', version: 'latest' });
    strict_1.default.deepEqual((0, classify_1.parseTag)('refs/tags/widget#7^{}'), { tag: 'widget#7', name: 'widget', version: '7' });
    strict_1.default.deepEqual((0, classify_1.parseTag)('refs/tags/a/b/c#2'), { tag: 'a/b/c#2', name: 'a/b/c', version: '2' });
});
(0, node_test_1.test)('parseTag splits at the last #, so branch names may contain #', () => {
    strict_1.default.deepEqual((0, classify_1.parseTag)('widget/br#anch#1'), { tag: 'widget/br#anch#1', name: 'widget/br#anch', version: '1' });
});
(0, node_test_1.test)('parseTag returns null for tags without #', () => {
    strict_1.default.equal((0, classify_1.parseTag)('refs/tags/milestone-tag'), null);
    strict_1.default.equal((0, classify_1.parseTag)('v1.0'), null);
});
(0, node_test_1.test)('actionDirsFromPaths keeps only directories carrying an action.yml', () => {
    const dirs = (0, classify_1.actionDirsFromPaths)([
        'action.yml',
        'widget/action.yml',
        'a/b/action.yml',
        'a/b/other.yml',
        '.github/actions/setup-and-build/action.yml',
        '_shared/cache-xfer/lib.ts',
        'widget/index.ts',
    ]);
    strict_1.default.deepEqual([...dirs].sort(), ['.github/actions/setup-and-build', 'a/b', 'widget']);
});
(0, node_test_1.test)('actionDirsFromPaths never adds the repo root', () => {
    const dirs = (0, classify_1.actionDirsFromPaths)(['action.yml']);
    strict_1.default.equal(dirs.size, 0);
});
(0, node_test_1.test)('a release tag for a living action is kept', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget#latest', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: "action 'widget' exists on master" });
});
(0, node_test_1.test)('a release tag for a dead action is deleted', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/go-packages#latest', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'delete', why: "no directory 'go-packages' exists on master" });
});
(0, node_test_1.test)('a branch tag for a dead action is deleted', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/go-packages/pi-signoff#1', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'delete', why: "no directory 'go-packages/pi-signoff' exists on master" });
});
(0, node_test_1.test)('a nested path only matches when every segment up to the action is real', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/shared/cache-xfer#1', ctx());
    strict_1.default.equal(verdict.kind, 'delete');
});
(0, node_test_1.test)('a branch tag whose branch is gone is deleted', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget/dead-branch#1', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'delete', why: "branch 'dead-branch' no longer exists" });
});
(0, node_test_1.test)('a branch tag whose branch exists is kept', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget/feature-branch#3', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: "branch 'feature-branch' exists" });
});
(0, node_test_1.test)('a branch tag for the current branch is kept even when the remote list lacks it', () => {
    const c = ctx({ branches: new Set([]) });
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget/master#1', c);
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: "branch 'master' is the current branch" });
});
(0, node_test_1.test)('branch names may contain slashes', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget/claude/session-bdZri#1', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: "branch 'claude/session-bdZri' exists" });
});
(0, node_test_1.test)('the deepest action root wins, and the branch is the rest', () => {
    const c = ctx({ actionDirs: new Set(['widget', 'widget/sub']) });
    strict_1.default.deepEqual((0, classify_1.classifyTag)('refs/tags/widget/sub/feature-branch#1', c), {
        kind: 'keep',
        why: "branch 'feature-branch' exists",
    });
    strict_1.default.deepEqual((0, classify_1.classifyTag)('refs/tags/widget/other#1', c), {
        kind: 'delete',
        why: "branch 'other' no longer exists",
    });
});
(0, node_test_1.test)('an internal action directory is a valid action root', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/.github/actions/setup-and-build/feature-branch#1', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: "branch 'feature-branch' exists" });
});
(0, node_test_1.test)('a garbage version is deleted even for a living action', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget#null', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'delete', why: "version 'null' is neither a number nor latest" });
});
(0, node_test_1.test)('an empty version is garbage', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/widget#', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'delete', why: "version '' is neither a number nor latest" });
});
(0, node_test_1.test)('numbered and latest versions are sane', () => {
    strict_1.default.equal((0, classify_1.classifyTag)('refs/tags/widget#0', ctx()).kind, 'keep');
    strict_1.default.equal((0, classify_1.classifyTag)('refs/tags/widget#12', ctx()).kind, 'keep');
    strict_1.default.equal((0, classify_1.classifyTag)('refs/tags/widget#latest', ctx()).kind, 'keep');
});
(0, node_test_1.test)('a tag without # is kept and never guessed at', () => {
    const verdict = (0, classify_1.classifyTag)('refs/tags/release-snapshot', ctx());
    strict_1.default.deepEqual(verdict, { kind: 'keep', why: 'no #, not a release tag' });
});
