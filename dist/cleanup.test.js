"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const index_1 = require("./index");
function sh(cwd, ...args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd, encoding: 'utf8' });
}
// One live action (widget), one surviving branch, one deleted branch, and a
// tag for every classification outcome. Everything is local: a bare origin on
// disk, no token, no network.
function makeScenario() {
    const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'tag-cleanup-'));
    const origin = (0, node_path_1.join)(dir, 'origin.git');
    const repo = (0, node_path_1.join)(dir, 'repo');
    sh(dir, 'init', '--quiet', '--bare', origin);
    sh(origin, 'symbolic-ref', 'HEAD', 'refs/heads/master');
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(repo, 'widget'), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(repo, 'widget', 'action.yml'), 'runs:\n  using: composite\n');
    sh(repo, 'init', '--quiet');
    sh(repo, 'config', 'user.email', 't@example.com');
    sh(repo, 'config', 'user.name', 'test');
    sh(repo, 'checkout', '--quiet', '-b', 'master');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '--quiet', '-m', 'source');
    sh(repo, 'remote', 'add', 'origin', origin);
    sh(repo, 'push', '--quiet', 'origin', 'master');
    // A branch that survives the sweep
    sh(repo, 'checkout', '--quiet', '-b', 'feature-branch');
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(repo, 'widget', 'extra.txt'), 'x');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '--quiet', '-m', 'branch work');
    sh(repo, 'push', '--quiet', 'origin', 'feature-branch');
    sh(repo, 'checkout', '--quiet', 'master');
    const tags = [
        'widget#1',
        'widget#latest',
        'widget#null',
        'dead-action#latest',
        'widget/dead-branch#1',
        'widget/feature-branch#1',
        'widget/master#1',
        'plainref',
    ];
    for (const tag of tags) {
        sh(repo, 'tag', tag);
    }
    sh(repo, 'push', '--quiet', 'origin', '--tags');
    return { origin, repo, dir };
}
function remoteTags(origin) {
    const out = sh(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/tags');
    return new Set(out.split('\n').filter((line) => line.length > 0));
}
function readOutputValue(outputFile, name) {
    const content = (0, node_fs_1.readFileSync)(outputFile, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`${name}<<`)) {
            return lines[i + 1];
        }
    }
    throw new Error(`output '${name}' not found in ${outputFile}`);
}
async function runCleanup(scenario, dryRun) {
    const outputFile = (0, node_path_1.join)(scenario.dir, 'output.txt');
    // @actions/core appends to GITHUB_OUTPUT and requires the file to exist
    (0, node_fs_1.writeFileSync)(outputFile, '');
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = outputFile;
    try {
        await (0, index_1.run)({ cwd: scenario.repo, dryRun, currentBranch: 'master' });
    }
    finally {
        if (previous === undefined)
            delete process.env.GITHUB_OUTPUT;
        else
            process.env.GITHUB_OUTPUT = previous;
    }
    return outputFile;
}
(0, node_test_1.test)('sweeps tags whose action, branch, or version is gone', async () => {
    const scenario = makeScenario();
    try {
        const outputFile = await runCleanup(scenario, false);
        const tags = remoteTags(scenario.origin);
        strict_1.default.ok(tags.has('widget#1'), 'live release tag must survive');
        strict_1.default.ok(tags.has('widget#latest'), 'live #latest must survive');
        strict_1.default.ok(tags.has('widget/feature-branch#1'), 'branch tag of a live branch must survive');
        strict_1.default.ok(tags.has('widget/master#1'), 'branch tag of the current branch must survive');
        strict_1.default.ok(tags.has('plainref'), 'a tag without # must never be touched');
        strict_1.default.ok(!tags.has('widget#null'), 'garbage version must be deleted');
        strict_1.default.ok(!tags.has('dead-action#latest'), 'dead action tag must be deleted');
        strict_1.default.ok(!tags.has('widget/dead-branch#1'), 'dead branch tag must be deleted');
        strict_1.default.equal(readOutputValue(outputFile, 'deleted-count'), '3');
    }
    finally {
        (0, node_fs_1.rmSync)(scenario.dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('a dry run reports deletions without performing them', async () => {
    const scenario = makeScenario();
    try {
        const outputFile = await runCleanup(scenario, true);
        const tags = remoteTags(scenario.origin);
        strict_1.default.ok(tags.has('widget#null'), 'dry run must not delete');
        strict_1.default.ok(tags.has('dead-action#latest'), 'dry run must not delete');
        strict_1.default.ok(tags.has('widget/dead-branch#1'), 'dry run must not delete');
        strict_1.default.equal(readOutputValue(outputFile, 'deleted-count'), '0');
    }
    finally {
        (0, node_fs_1.rmSync)(scenario.dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('an unreachable origin fails loudly instead of sweeping blind', async () => {
    const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'tag-cleanup-broken-'));
    try {
        const repo = (0, node_path_1.join)(dir, 'repo');
        (0, node_fs_1.mkdirSync)(repo, { recursive: true });
        sh(repo, 'init', '--quiet');
        sh(repo, 'config', 'user.email', 't@example.com');
        sh(repo, 'config', 'user.name', 'test');
        sh(repo, 'remote', 'add', 'origin', (0, node_path_1.join)(dir, 'missing.git'));
        await strict_1.default.rejects(() => (0, index_1.run)({ cwd: repo, dryRun: false, currentBranch: 'master' }));
    }
    finally {
        (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
    }
});
