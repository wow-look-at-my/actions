import * as core from '@actions/core';
import {globSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {DEFAULTS, failureReport, hasFailures, lintFiles, type Options} from './lint';

// A patterns input of "" would glob nothing and pass, which is the silent
// no-op this action exists to prevent, so an empty match is a failure.
function patternsOf(raw: string): string[] {
	return raw
		.split(/[\s,]+/)
		.map((p) => p.trim())
		.filter(Boolean);
}

function numberInput(name: string, fallback: number): number {
	const raw = core.getInput(name).trim();
	if (raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number, got "${raw}"`);
	return n;
}

function preview(items: string[], limit = 20, join = ', '): string {
	return items.slice(0, limit).join(join) + (items.length > limit ? ', ...' : '');
}

function main(): void {
	const patterns = patternsOf(core.getInput('files') || '**/*.md');
	const opts: Options = {
		hardMaxWords: numberInput('hard-max-words', DEFAULTS.hardMaxWords),
		warnMaxWords: numberInput('warn-max-words', DEFAULTS.warnMaxWords),
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
		findings.hardLong.length + findings.contractions.length + findings.bannedModals.length + findings.semicolons.length,
	);

	if (hasFailures(findings)) {
		core.setFailed(
			'STE-style lint failed -- mechanical subset only, NOT full ASD-STE100 conformance ' +
				'(word choice against the approved dictionary is checked by convention, not by this tool):\n\n' +
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
			`Possible long noun cluster, heuristic only, not enforced (${findings.nounClusters.length} found): ${preview(findings.nounClusters, 20, ' | ')}`,
		);
	}
	if (findings.complexTense.length) {
		core.warning(
			`Possible complex verb tense (STE allows only simple tenses), heuristic only, not enforced ` +
				`(${findings.complexTense.length} found): ${preview(findings.complexTense, 20, ' | ')}`,
		);
	}
}

try {
	main();
} catch (err) {
	core.setFailed(err instanceof Error ? err.message : String(err));
}
