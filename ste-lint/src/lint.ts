// The mechanical subset of ASD-STE100 (Simplified Technical English): sentence
// length, contractions, banned modal verbs, semicolons, dictionary word choice, and
// (as warnings) complex verb tenses, passive voice, and long noun clusters. This is
// not full conformance -- the standard's own FAQ says ASD and the STEMG do not
// endorse a tool that claims to be "fully compliant," and several writing rules
// need real semantic judgment a pattern cannot do -- see docs/ste-lint-spec-mapping.md.

import {BANNED_WORDS} from './ste100-banned-words';

export interface Options {
	hardMaxWords: number;
	warnMaxWords: number;
}

export const DEFAULTS: Options = {hardMaxWords: 25, warnMaxWords: 20};

export interface Findings {
	// Each of these fails the run.
	hardLong: string[];
	contractions: string[];
	bannedModals: string[];
	semicolons: string[];
	// Each of these only warns: they are heuristics, and a heuristic that
	// fails a build teaches people to route around the check.
	warnLong: string[];
	passive: string[];
	nounClusters: string[];
	complexTense: string[];
	bannedWords: string[];
	longParagraphs: string[];
}

export function emptyFindings(): Findings {
	return {
		hardLong: [],
		contractions: [],
		bannedModals: [],
		semicolons: [],
		warnLong: [],
		passive: [],
		nounClusters: [],
		complexTense: [],
		bannedWords: [],
		longParagraphs: [],
	};
}

export function hasFailures(f: Findings): boolean {
	return f.hardLong.length > 0 || f.contractions.length > 0 || f.bannedModals.length > 0 || f.semicolons.length > 0;
}

const CONTRACTION_RE =
	/\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|wouldn't|shouldn't|couldn't|mustn't|hasn't|haven't|hadn't|it's|that's|there's|here's|let's|we're|they're|you're|i'm|i've|we've|they've|you've|i'll|we'll|they'll|you'll|he's|she's|who's|what's)\b/gi;

// STE's approved obligation word is "must"/"must not" (dictionary rule MUST (v)).
// "could" is explicitly banned in the dictionary ("Do not use COULD (v) to show
// possibility" -- use "can"). "might" and "would" are absent from the dictionary
// entirely, same as "should" and "shall". "may" is deliberately left out: it is
// also a calendar month, and that collision would make this a false-positive trap.
const BANNED_MODAL_RE = /\b(should|shall|could|might|would)\b/gi;

const SEMICOLON_RE = /;/g;

// Rule 3.2: STE approves only the infinitive, the imperative, the simple present,
// simple past, simple future, and the past participle as an adjective. "has/have/had
// done X" (present/past perfect) and "will have done X" (future perfect) are named as
// banned complex constructions in rule 3.4. A regular past participle ends "-ed"; the
// rest of this list is the common irregular set.
const IRREGULAR_PARTICIPLES = [
	'been', 'become', 'begun', 'bent', 'bought', 'broken', 'brought', 'built', 'burst', 'caught',
	'chosen', 'come', 'cut', 'dealt', 'done', 'drawn', 'driven', 'eaten', 'fallen', 'fed', 'felt',
	'fought', 'found', 'flown', 'forgotten', 'frozen', 'given', 'gone', 'gotten', 'got', 'grown',
	'had', 'heard', 'held', 'hidden', 'hit', 'hurt', 'kept', 'known', 'laid', 'left', 'lent', 'let',
	'lit', 'lost', 'made', 'meant', 'met', 'paid', 'put', 'read', 'ridden', 'risen', 'run', 'said',
	'seen', 'sent', 'set', 'shown', 'shut', 'sold', 'sought', 'spent', 'spoken', 'spread', 'stood',
	'stolen', 'struck', 'swum', 'taken', 'taught', 'thought', 'thrown', 'told', 'understood', 'won',
	'worn', 'written',
];
const PARTICIPLE_PATTERN = `(?:[a-z]+ed|${IRREGULAR_PARTICIPLES.join('|')})`;
const PERFECT_TENSE_RE = new RegExp(
	`\\b(?:will\\s+have|has|have|had)\\b(?:\\s+(?:not|never|already|just|recently|still))?\\s+(${PARTICIPLE_PATTERN})\\b`,
	'gi',
);

// Rule 3.2/3.5: the present and past progressive ("is/was adjusting") are named as
// banned tenses. STE approves a handful of "-ing" words as a noun (lighting, opening,
// routing, servicing), an adjective (mating, missing, remaining), a pronoun
// (something), and a preposition (during). Only the adjective, pronoun, and
// preposition forms are exempt here: right after a bare "is/are/was/were" with no
// article, the noun forms almost always signal the banned progressive tense, not the
// approved noun (which normally needs an article: "is an opening", not "is opening").
const PROGRESSIVE_EXEMPT = ['mating', 'missing', 'remaining', 'something', 'during'];
const PROGRESSIVE_TENSE_RE = new RegExp(
	`\\b(?:is|are|was|were|am|been)\\b(?:\\s+not)?\\s+(?!(?:${PROGRESSIVE_EXEMPT.join('|')})\\b)([a-z]+ing)\\b`,
	'gi',
);

// Rule 1.1-1.3: a word not in the dictionary, or used with an unapproved meaning,
// is not STE. BANNED_WORDS covers only the words this checker can safely flag by
// text alone (see ste100-banned-words.ts for what was excluded and why).
const WORD_TOKEN_RE = /[a-z][a-z'-]*/gi;

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

const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+\.)\s+/;

export function isListLine(line: string): boolean {
	return LIST_MARKER_RE.test(line);
}

export function stripMarkup(line: string): string {
	return line
		.replace(LIST_MARKER_RE, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_]{1,3}/g, '')
		.trim();
}

export function sentences(text: string): string[] {
	return text.split(/(?<=[.!?])\s+(?=[A-Z0-9(`'])/);
}

// Rule 8.5: text in parentheses counts as one word, whatever it contains.
// Collapsed before the split so a reference like "(refer to paragraphs 2 thru 5)"
// does not inflate the count against the sentence-length caps.
export function wordCount(sentence: string): number {
	const collapsed = sentence.replace(/\([^()]*\)/g, ' (x) ');
	return collapsed.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
}

// A run of four or more content words with nothing between them is the noun
// string STE tells you to break up (rule 2.1: no more than three words).
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

	// Rule 6.6: no more than six sentences in a paragraph. A paragraph is a run of
	// non-blank, non-skippable lines; a list line never adds to the count, because
	// the standard's own worked example counts an entire intro sentence plus its
	// vertical list as ONE sentence -- the intro line supplies that one sentence.
	let inParagraph = false;
	let paragraphStartLine = 0;
	let paragraphSentences = 0;
	const flushParagraph = () => {
		if (paragraphSentences > 6) {
			into.longParagraphs.push(`${name}:${paragraphStartLine}: ${paragraphSentences} sentences in one paragraph`);
		}
		inParagraph = false;
		paragraphSentences = 0;
	};

	for (let i = 0; i < lines.length; i++) {
		const at = `${name}:${i + 1}`;
		if (isSkippableLine(lines[i]) || !lines[i].trim()) {
			flushParagraph();
			continue;
		}
		const cleaned = stripMarkup(lines[i]);
		if (!cleaned) {
			flushParagraph();
			continue;
		}
		if (!inParagraph) {
			inParagraph = true;
			paragraphStartLine = i + 1;
		}
		if (!isListLine(lines[i])) paragraphSentences += sentences(cleaned).length;

		let m: RegExpExecArray | null;
		CONTRACTION_RE.lastIndex = 0;
		while ((m = CONTRACTION_RE.exec(cleaned))) into.contractions.push(`${at}: "${m[0]}"`);
		BANNED_MODAL_RE.lastIndex = 0;
		while ((m = BANNED_MODAL_RE.exec(cleaned))) into.bannedModals.push(`${at}: "${m[0]}"`);
		SEMICOLON_RE.lastIndex = 0;
		while ((m = SEMICOLON_RE.exec(cleaned))) into.semicolons.push(`${at}: ";"`);
		PERFECT_TENSE_RE.lastIndex = 0;
		while ((m = PERFECT_TENSE_RE.exec(cleaned))) into.complexTense.push(`${at}: "${m[0]}" (perfect tense; STE allows only simple tenses)`);
		PROGRESSIVE_TENSE_RE.lastIndex = 0;
		while ((m = PROGRESSIVE_TENSE_RE.exec(cleaned))) {
			into.complexTense.push(`${at}: "${m[0]}" (progressive tense; STE allows only simple tenses)`);
		}

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

		WORD_TOKEN_RE.lastIndex = 0;
		let w: RegExpExecArray | null;
		while ((w = WORD_TOKEN_RE.exec(cleaned))) {
			// Object.hasOwn, because a table written as an object literal answers
			// for "constructor", "toString" and every other Object.prototype
			// name with a function. That read as a banned word and threw on
			// join, so one ordinary English word crashed the whole run.
			const key = w[0].toLowerCase();
			const alts = Object.hasOwn(BANNED_WORDS, key) ? BANNED_WORDS[key] : undefined;
			if (alts) into.bannedWords.push(`${at}: "${w[0]}" -- use ${alts.join(' or ')}`);
		}
	}
	flushParagraph();
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
	if (f.bannedModals.length) {
		problems.push(
			`STE bans "should"/"shall"/"could"/"might"/"would" -- use "must"/"must not" for obligation and "can" for ability or possibility:\n${f.bannedModals.join('\n')}`,
		);
	}
	if (f.semicolons.length) {
		problems.push(`STE bans the semicolon -- use a period and start a new sentence:\n${f.semicolons.join('\n')}`);
	}
	return problems.join('\n\n');
}
