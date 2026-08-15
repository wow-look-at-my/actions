// The mechanical subset of ASD-STE100 (Simplified Technical English): sentence
// length, contractions, and "should"/"shall". This is not full conformance --
// the standard's approved-word dictionary is a licensed commercial document
// with no free machine-readable copy, so word choice stays a convention.

export interface Options {
	hardMaxWords: number;
	warnMaxWords: number;
}

export const DEFAULTS: Options = {hardMaxWords: 25, warnMaxWords: 20};

export interface Findings {
	// Each of these fails the run.
	hardLong: string[];
	contractions: string[];
	shouldShall: string[];
	// Each of these only warns: they are heuristics, and a heuristic that
	// fails a build teaches people to route around the check.
	warnLong: string[];
	passive: string[];
	nounClusters: string[];
}

export function emptyFindings(): Findings {
	return {hardLong: [], contractions: [], shouldShall: [], warnLong: [], passive: [], nounClusters: []};
}

export function hasFailures(f: Findings): boolean {
	return f.hardLong.length > 0 || f.contractions.length > 0 || f.shouldShall.length > 0;
}

const CONTRACTION_RE =
	/\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|wouldn't|shouldn't|couldn't|mustn't|hasn't|haven't|hadn't|it's|that's|there's|here's|let's|we're|they're|you're|i'm|i've|we've|they've|you've|i'll|we'll|they'll|you'll|he's|she's|who's|what's)\b/gi;

const SHOULD_SHALL_RE = /\b(should|shall)\b/gi;

// Words too ordinary to be part of a noun cluster.
const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
	'were', 'be', 'been', 'must', 'not', 'never', 'always', 'you', 'your', 'it', 'its', 'this',
	'that', 'these', 'those', 'if', 'when', 'where', 'which', 'who', 'as', 'at', 'by', 'from',
	'into', 'than', 'then', 'so', 'do', 'does', 'did', 'can', 'will', 'would', 'no', 'yes', 'one',
	'each', 'every', 'only', 'also', 'more', 'most', 'all', 'any', 'none', 'same',
]);

// Blanks code instead of dropping it, so every finding still points at the
// line it came from.
export function stripCode(text: string): string {
	const out: string[] = [];
	let inFence = false;
	for (const line of text.split('\n')) {
		if (/^\s*(`{3,}|~{3,})/.test(line)) {
			inFence = !inFence;
			out.push('');
			continue;
		}
		if (inFence) {
			out.push('');
			continue;
		}
		out.push(line.replace(/`[^`]*`/g, (m) => m.replace(/[^\n]/g, ' ')));
	}
	return out.join('\n');
}

// A quotation is someone else's voice, so the rules do not apply to it. The
// character class spans newlines, which keeps a quote wrapped across lines
// intact.
export function stripQuotedSpans(text: string): string {
	return text.replace(/"[^"]*"/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function isSkippableLine(line: string): boolean {
	if (/^\s{0,3}#{1,6}\s/.test(line)) return true; // a heading is a headline, not a sentence
	if (/^\s*>/.test(line)) return true; // a blockquote is a verbatim quote
	if (/^\s*\|/.test(line)) return true; // a table cell is a fragment
	return false;
}

export function stripMarkup(line: string): string {
	return line
		.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_]{1,3}/g, '')
		.trim();
}

export function sentences(text: string): string[] {
	return text.split(/(?<=[.!?])\s+(?=[A-Z0-9(`'])/);
}

export function wordCount(sentence: string): number {
	return sentence.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
}

// A run of four or more content words with nothing between them is the noun
// string STE tells you to break up.
export function nounRuns(line: string): string[] {
	const runs: string[] = [];
	let run: string[] = [];
	for (const w of line.split(/\s+/).filter(Boolean)) {
		const bare = w.replace(/[^a-zA-Z]/g, '');
		if (bare.length >= 3 && !STOPWORDS.has(bare.toLowerCase())) {
			run.push(bare);
		} else {
			if (run.length >= 4) runs.push(run.join(' '));
			run = [];
		}
	}
	if (run.length >= 4) runs.push(run.join(' '));
	return runs;
}

export function lintText(name: string, text: string, opts: Options = DEFAULTS, into = emptyFindings()): Findings {
	const lines = stripQuotedSpans(stripCode(text)).split('\n');
	for (let i = 0; i < lines.length; i++) {
		const at = `${name}:${i + 1}`;
		if (isSkippableLine(lines[i])) continue;
		const cleaned = stripMarkup(lines[i]);
		if (!cleaned) continue;

		let m: RegExpExecArray | null;
		CONTRACTION_RE.lastIndex = 0;
		while ((m = CONTRACTION_RE.exec(cleaned))) into.contractions.push(`${at}: "${m[0]}"`);
		SHOULD_SHALL_RE.lastIndex = 0;
		while ((m = SHOULD_SHALL_RE.exec(cleaned))) into.shouldShall.push(`${at}: "${m[0]}"`);

		for (const s of sentences(cleaned)) {
			const n = wordCount(s);
			if (n > opts.hardMaxWords) {
				into.hardLong.push(`${at}: ${n} words: "${s.slice(0, 100)}${s.length > 100 ? '...' : ''}"`);
			} else if (n > opts.warnMaxWords) {
				into.warnLong.push(`${at}: ${n} words`);
			}
		}

		if (/\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/i.test(cleaned)) into.passive.push(at);
		for (const run of nounRuns(cleaned)) into.nounClusters.push(`${at}: "${run}"`);
	}
	return into;
}

export function lintFiles(files: {name: string; text: string}[], opts: Options = DEFAULTS): Findings {
	const findings = emptyFindings();
	for (const f of files) lintText(f.name, f.text, opts, findings);
	return findings;
}

export function failureReport(f: Findings, opts: Options): string {
	const problems: string[] = [];
	if (f.hardLong.length) {
		problems.push(
			`Sentences over ${opts.hardMaxWords} words (STE's own outer bound, for a description; an instruction caps at ${opts.warnMaxWords}):\n${f.hardLong.join('\n')}`,
		);
	}
	if (f.contractions.length) problems.push(`Contractions are banned in STE:\n${f.contractions.join('\n')}`);
	if (f.shouldShall.length) {
		problems.push(`STE requires "must"/"must not" for obligation, never "should"/"shall":\n${f.shouldShall.join('\n')}`);
	}
	return problems.join('\n\n');
}
