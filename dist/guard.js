"use strict";
// A rule is only as strong as the step that runs it. Two ways a red run turns
// green without a word of prose changing: put `continue-on-error: true` on the
// step, or move the `uses:` ref back to a tag that passed. Neither is visible
// in the check's own output, which is what makes them worth reaching for.
//
// So the step reports the ref it runs as, and it FAILS when it finds itself
// wrapped in `continue-on-error`. A step allowed to fail is not a gate, and a
// gate that says nothing about being switched off is decoration.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKERS = void 0;
exports.workflowPath = workflowPath;
exports.neuteredSteps = neuteredSteps;
exports.guard = guard;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// GITHUB_WORKFLOW_REF is "owner/repo/.github/workflows/ci.yml@refs/heads/main".
// The path in the middle is what this needs.
function workflowPath(ref) {
    const withoutGitRef = ref.split('@')[0];
    const parts = withoutGitRef.split('/');
    if (parts.length < 3)
        return undefined;
    return parts.slice(2).join('/');
}
// Finds the step block each `uses:` of this action opens, and reports the
// blocks that carry continue-on-error. A YAML parser is not available here:
// the runtime is the standard library plus @actions/core, so this reads the
// step's own indentation instead.
// common-checks calls this action, so the caller's own step names the wrapper
// and not ste-lint. A continue-on-error on that step switches this gate off
// too, so both names count as this step.
exports.MARKERS = ['ste-lint', 'common-checks'];
function neuteredSteps(workflow, markers = exports.MARKERS) {
    const lines = workflow.split('\n');
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const open = /^(\s*)-\s+(?:uses|name)\s*:/.exec(lines[i]);
        if (!open)
            continue;
        const indent = open[1].length;
        let uses = '';
        let neutered = false;
        for (let j = i; j < lines.length; j++) {
            const next = /^(\s*)-\s/.exec(lines[j]);
            if (j > i && next && next[1].length <= indent)
                break;
            if (/^\s*-?\s*uses\s*:/.test(lines[j]) && markers.some((marker) => lines[j].includes(marker)))
                uses = lines[j].trim();
            if (/^\s*continue-on-error\s*:\s*true\b/.test(lines[j]))
                neutered = true;
        }
        if (uses && neutered)
            found.push(`${uses} (line ${i + 1})`);
    }
    return found;
}
function guard(env) {
    const notes = [];
    const unknown = [];
    notes.push(`ste-lint ref: ${env.actionRef || 'unknown'}`);
    if (!env.workflowRef || !env.workspace) {
        unknown.push('whether this step runs with continue-on-error: no workflow reference in the environment');
        return { notes, unknown };
    }
    const path = workflowPath(env.workflowRef);
    if (!path) {
        unknown.push(`whether this step runs with continue-on-error: cannot read a path out of "${env.workflowRef}"`);
        return { notes, unknown };
    }
    let workflow;
    try {
        workflow = (0, node_fs_1.readFileSync)((0, node_path_1.join)(env.workspace, path), 'utf-8');
    }
    catch (err) {
        unknown.push(`whether this step runs with continue-on-error: ${path} is not readable (${err instanceof Error ? err.message : String(err)})`);
        return { notes, unknown };
    }
    const neutered = neuteredSteps(workflow);
    if (neutered.length) {
        return {
            notes,
            unknown,
            failure: `ste-lint runs under continue-on-error in ${path}: ${neutered.join(', ')}. ` +
                'A step allowed to fail is not a gate. Remove continue-on-error, or remove the step and say so out loud.',
        };
    }
    return { notes, unknown };
}
