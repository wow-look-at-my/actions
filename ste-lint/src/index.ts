import * as core from '@actions/core';
import {globSync, readFileSync} from 'node:fs';
import {currentEvent, scopeOf} from './changed';
import {guard} from './guard';
import {describe, fetchSlopfix, onTouched, report, type Finding} from './slopfix';
import {inSubmodule, submodulePaths} from './submodules';
import {vendoredPaths} from './vendored';

function gitmodules(): string {
	try {
		return readFileSync('.gitmodules', 'utf-8');
	} catch {
		return '';
	}
}

// A patterns input of "" would glob nothing and pass, which is the silent
// no-op this action exists to prevent, so an empty match is a failure.
function patternsOf(raw: string): string[] {
	return raw
		.split(/[\s,]+/)
		.map((p) => p.trim())
		.filter(Boolean);
}

// The cap inputs are gone. slopfix owns the cap, so an old caller's value does nothing.
const REMOVED = ['hard-max-words', 'warn-max-words'];

function warnRemovedInputs(): void {
	for (const name of REMOVED) {
		if (core.getInput(name).trim() !== '') core.warning(`${name} does nothing. slopfix enforces the STE cap of 25 words. Remove the input.`);
	}
}

async function main(): Promise<void> {
	const gate = guard({
		workspace: process.env.GITHUB_WORKSPACE,
		workflowRef: process.env.GITHUB_WORKFLOW_REF,
		actionRef: process.env.GITHUB_ACTION_REF,
	});
	for (const note of gate.notes) core.info(note);
	// A check that did not happen is never a check that passed.
	for (const u of gate.unknown) core.error(`ste-lint could not establish ${u}`);
	if (gate.failure) {
		core.setFailed(gate.failure);
		return;
	}
	warnRemovedInputs();

	const patterns = patternsOf(core.getInput('files') || '**/*.md');
	const matched = [...new Set(patterns.flatMap((p) => globSync(p, {exclude: (n: string) => n.includes('node_modules')})))].sort();
	if (matched.length === 0) {
		core.setFailed(`ste-lint matched no files: ${patterns.join(' ')}. A check that reads nothing passes for the wrong reason.`);
		return;
	}
	const submodules = submodulePaths(gitmodules());
	const skip = inSubmodule(submodules);
	const ours = matched.filter((name) => !skip(name));
	if (submodules.length) core.info(`ste-lint: ${matched.length - ours.length} file(s) belong to a submodule: ${submodules.join(' ')}`);
	const vendored = vendoredPaths(ours);
	const theirs = ours.filter((name) => !vendored.has(name));
	if (vendored.size) core.info(`ste-lint: ${ours.length - theirs.length} file(s) are marked linguist-vendored or linguist-generated`);
	if (theirs.length === 0) {
		core.setFailed(
			`ste-lint read none of the ${matched.length} file(s) that ${patterns.join(' ')} matched: every one belongs to another repository. ` +
				'A check that reads nothing passes for the wrong reason.',
		);
		return;
	}

	// The scope is the line this event changed, not the file it sits in. A
	// sentence the change did not write is somebody else's finding, on somebody
	// else's commit.
	const scope = scopeOf(currentEvent());
	core.info(scope.note);
	const names = scope.touched === null ? theirs : theirs.filter((name) => scope.touched?.has(name));
	if (scope.touched !== null && names.length === 0) {
		core.info('ste-lint: this change touched none of them, so there is nothing to check');
		core.setOutput('files', 0);
		core.setOutput('violations', 0);
		return;
	}
	core.info(`ste-lint: ${names.length} file(s)`);

	const binary = await fetchSlopfix();
	const failures: string[] = [];
	for (const name of names) {
		const text = readFileSync(name, 'utf-8');
		let findings: Finding[] = report(binary, name, text);
		const touched = scope.touched?.get(name);
		if (touched) findings = onTouched(findings, text.split('\n'), touched);
		failures.push(...findings.map((f) => describe(name, f)));
	}
	core.setOutput('files', names.length);
	core.setOutput('violations', failures.length);
	if (failures.length) {
		const where = scope.touched === null ? 'in the files above' : 'on the lines this change wrote';
		core.setFailed(`slopfix rejects ${failures.length} finding(s) ${where}. \`slopfix fix <file>\` repairs most of them:\n\n${failures.join('\n')}`);
	}
}

main().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
