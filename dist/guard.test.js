"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const guard_1 = require("./guard");
(0, node_test_1.test)('the workflow path is the middle of GITHUB_WORKFLOW_REF', () => {
    strict_1.default.equal((0, guard_1.workflowPath)('o/r/.github/workflows/ci.yml@refs/heads/main'), '.github/workflows/ci.yml');
    strict_1.default.equal((0, guard_1.workflowPath)('o/r/.github/workflows/a/b.yml@refs/tags/v1'), '.github/workflows/a/b.yml');
    strict_1.default.equal((0, guard_1.workflowPath)('too/short'), undefined);
});
const workflow = (extra) => `name: CI
on:
  push:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: wow-look-at-my/actions@ste-lint#latest
${extra}      - run: node tools/check-links.mjs
`;
(0, node_test_1.test)('a step allowed to fail is found, and a plain one is not', () => {
    strict_1.default.deepEqual((0, guard_1.neuteredSteps)(workflow('')), []);
    const found = (0, guard_1.neuteredSteps)(workflow('        continue-on-error: true\n'));
    strict_1.default.equal(found.length, 1);
    strict_1.default.match(found[0], /uses: wow-look-at-my\/actions@ste-lint#latest/);
});
(0, node_test_1.test)('continue-on-error on a different step is not this step', () => {
    const other = `name: CI
jobs:
  checks:
    steps:
      - uses: wow-look-at-my/actions@ste-lint#latest
      - run: flaky
        continue-on-error: true
`;
    strict_1.default.deepEqual((0, guard_1.neuteredSteps)(other), []);
});
function workspaceWith(text) {
    const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'ste-guard-'));
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(dir, '.github', 'workflows'), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(dir, '.github', 'workflows', 'ci.yml'), text);
    return dir;
}
(0, node_test_1.test)('the ref this action runs as is reported on every run', () => {
    const g = (0, guard_1.guard)({ actionRef: 'ste-lint#3' });
    strict_1.default.deepEqual(g.notes, ['ste-lint ref: ste-lint#3']);
});
(0, node_test_1.test)('a neutered step fails the run', () => {
    const dir = workspaceWith(workflow('        continue-on-error: true\n'));
    const g = (0, guard_1.guard)({ workspace: dir, workflowRef: 'o/r/.github/workflows/ci.yml@refs/heads/main', actionRef: 'ste-lint#latest' });
    strict_1.default.match(g.failure ?? '', /runs under continue-on-error/);
});
(0, node_test_1.test)('an ordinary step passes and reports nothing unknown', () => {
    const dir = workspaceWith(workflow(''));
    const g = (0, guard_1.guard)({ workspace: dir, workflowRef: 'o/r/.github/workflows/ci.yml@refs/heads/main' });
    strict_1.default.equal(g.failure, undefined);
    strict_1.default.deepEqual(g.unknown, []);
});
// Never silent: a check it could not make is a thing it says it does not know.
(0, node_test_1.test)('an unreadable workflow is named as unknown, not passed over', () => {
    const g = (0, guard_1.guard)({ workspace: '/nonexistent', workflowRef: 'o/r/.github/workflows/ci.yml@refs/heads/main' });
    strict_1.default.equal(g.failure, undefined);
    strict_1.default.equal(g.unknown.length, 1);
    strict_1.default.match(g.unknown[0], /not readable/);
    const h = (0, guard_1.guard)({ workspace: '/tmp' });
    strict_1.default.match(h.unknown[0], /no workflow reference/);
});
