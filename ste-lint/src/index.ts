import * as core from '@actions/core';
import {globSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {guard} from './guard';
import {capped, STE_MAX_WORDS} from './inputs';
import {DEFAULTS, failureReport, hasFailures, lintFiles, type Options} from './lint';

// A patterns input of "" would glob nothing and pass, which is the silent
// no-op this action exists to prevent, so an empty match is a failure.
function patternsOf(raw: string): string[] {
	return raw
		.split(/[\s,]+/)
		.map((p) => p.trim())
		.filter(Boolean);
}

function preview(items: string[], limit = 20): string {
	const shown = items.slice(0, limit).map(item => `\n  ${item}`).join('');
	return shown + (items.length > limit ? `\n  ... and ${items.length - limit} more` : '');
}

function main(): void {
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

	const patterns = patternsOf(core.getInput('files') || '**/*.md');
	const opts: Options = {
		hardMaxWords: capped('hard-max-words', core.getInput('hard-max-words'), DEFAULTS.hardMaxWords, STE_MAX_WORDS),
		warnMaxWords: capped('warn-max-words', core.getInput('warn-max-words'), DEFAULTS.warnMaxWords, STE_MAX_WORDS),
	};
	if (opts.warnMaxWords > opts.hardMaxWords) {
		throw new Error(`warn-max-words (${opts.warnMaxWords}) must not exceed hard-max-words (${opts.hardMaxWords})`);
	}

	const names = [...new Set(patterns.flatMap((p) => globSync(p, {exclude: (n: string) => n.includes('node_modules')})))].sort();
	if (names.length === 0) {
		core.setFailed(`ste-lint matched no files: ${patterns.join(' ')}. A check that reads nothing passes for the wrong reason.`);
		return;
	}
	core.info(`ste-lint: ${names.length} file(s)`);

	const findings = lintFiles(
		names.map((name) => ({name, text: readFileSync(name, 'utf-8')})),
		opts,
	);

	core.setOutput('files', names.length);
	core.setOutput(
		'violations',
		findings.hardLong.length +
			findings.contractions.length +
			findings.bannedModals.length +
			findings.semicolons.length +
			findings.commaSplices.length +
			findings.wrappedLines.length,
	);

	if (hasFailures(findings)) {
		core.setFailed(
			'STE-style lint failed -- mechanical subset only, NOT full ASD-STE100 conformance ' +
				'(several writing rules need real semantic judgment a pattern cannot do; ' +
				'see docs/ste-lint-spec-mapping.md):\n\n' +
				failureReport(findings, opts),
		);
	}

	// Heuristics warn and never fail. Each one has real false positives, and a
	// check people learn to ignore is worse than no check.
	if (findings.warnLong.length) {
		core.warning(
			`Sentences over ${opts.warnMaxWords} words, under the ${opts.hardMaxWords}-word hard cap ` +
				`(an instruction stays at or under ${opts.warnMaxWords}; a description may run to ${opts.hardMaxWords}) ` +
				`(${findings.warnLong.length} found): ${preview(findings.warnLong)}`,
		);
	}
	if (findings.passive.length) {
		core.warning(`Possible passive voice, heuristic only, not enforced (${findings.passive.length} lines): ${preview(findings.passive)}`);
	}
	if (findings.nounClusters.length) {
		core.warning(
			`Possible long noun cluster, heuristic only, not enforced (${findings.nounClusters.length} found): ${preview(findings.nounClusters)}`,
		);
	}
	if (findings.complexTense.length) {
		core.warning(
			`Possible complex verb tense (STE allows only simple tenses), heuristic only, not enforced ` +
				`(${findings.complexTense.length} found): ${preview(findings.complexTense)}`,
		);
	}
	if (findings.bannedWords.length) {
		core.warning(
			`Word not approved in the ASD-STE100 dictionary, heuristic only, not enforced -- this checker ` +
				`matches text, not part of speech or meaning, so it can miss a word's approved sense ` +
				`(${findings.bannedWords.length} found): ${preview(findings.bannedWords)}`,
		);
	}
	if (findings.longParagraphs.length) {
		core.warning(
			`Paragraph over 6 sentences, heuristic only, not enforced ` +
				`(${findings.longParagraphs.length} found): ${preview(findings.longParagraphs)}`,
		);
	}
}

// Local mode: `node dist/index.js '**/*.md'` lints the given patterns and
// prints what CI prints. A finding count is then a command anyone can run, not
// a number somebody remembers.
function cli(patterns: string[]): number {
	const opts: Options = {...DEFAULTS};
	const names = [...new Set(patterns.flatMap((p) => globSync(p, {exclude: (n: string) => n.includes('node_modules')})))].sort();
	if (names.length === 0) {
		process.stderr.write(`ste-lint matched no files: ${patterns.join(' ')}\n`);
		return 2;
	}
	const findings = lintFiles(
		names.map((name) => ({name, text: readFileSync(name, 'utf-8')})),
		opts,
	);
	process.stdout.write(`ste-lint: ${names.length} file(s)\n`);
	for (const [label, list] of [
		['sentences over the cap', findings.hardLong],
		['contractions', findings.contractions],
		['banned modals', findings.bannedModals],
		['semicolons', findings.semicolons],
		['comma splices', findings.commaSplices],
		['hard-wrapped lines', findings.wrappedLines],
	] as const) {
		process.stdout.write(`${String(list.length).padStart(6)}  ${label}\n`);
	}
	if (!hasFailures(findings)) return 0;
	process.stderr.write('\n' + failureReport(findings, opts) + '\n');
	return 1;
}

const args = process.argv.slice(2);
if (args.length > 0) {
	process.exit(cli(args));
}

try {
	main();
} catch (err) {
	core.setFailed(err instanceof Error ? err.message : String(err));
}
