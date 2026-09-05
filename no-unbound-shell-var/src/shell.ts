// A bash script's variable references, read the way bash reads them: quoting,
// comments and heredocs decide whether a `$` expands at all. This is a lexer,
// not a parser -- it answers "which names does this script read", nothing more.

export interface VarRef {
	name: string;
	line: number;
}

export interface ShellScan {
	// Every name the script reads and does not guard with a default.
	refs: VarRef[];
	// Every name the script itself gives a value.
	assigned: Set<string>;
	nounset: boolean;
	// `set +u` anywhere. The scan cannot say which references it covers.
	nounsetOff: boolean;
}

// `${{ ... }}` is substituted by the runner before bash sees the script, so the
// lexer must not read one. Each character becomes `x`, which keeps every line
// number and every quoting state intact.
export function blankExpressions(script: string): string {
	return script.replace(/\$\{\{[\s\S]*?\}\}/g, match => match.replace(/[^\n]/g, 'x'));
}

// A name bash resolves itself. None of these is a variable the author declares.
const SPECIAL = new Set(['?', '$', '!', '#', '@', '*', '-', '_', '0']);

function isNameStart(char: string): boolean {
	return /[A-Za-z_]/.test(char);
}

function isNameChar(char: string): boolean {
	return /[A-Za-z0-9_]/.test(char);
}

// True when `${NAME<op>...}` supplies a value for an unset NAME.
function operatorGuards(rest: string): boolean {
	return /^:?[-=+?]/.test(rest);
}

interface Heredoc {
	delimiter: string;
	expands: boolean;
}

class Lexer {
	private readonly text: string;
	private index = 0;
	private line = 1;
	private readonly pending: Heredoc[] = [];
	readonly refs: VarRef[] = [];

	constructor(text: string) {
		this.text = text;
	}

	// The whole script, in the shell's outermost context.
	run(): void {
		this.scan(() => this.index >= this.text.length);
	}

	// Scans until `done` says stop. `done` is what makes a command substitution
	// end at its own `)` instead of running to the end of the script.
	private scan(done: () => boolean): void {
		while (!done()) {
			const char = this.text[this.index];
			if (char === '\\') {
				this.advance(2);
				continue;
			}
			if (char === '#' && this.atWordStart()) {
				this.skipToNewline();
				continue;
			}
			if (char === '\n') {
				this.advance(1);
				this.drainHeredocs();
				continue;
			}
			if (char === "'") {
				this.skipSingleQuoted();
				continue;
			}
			if (char === '"') {
				this.scanDoubleQuoted();
				continue;
			}
			if (char === '<' && this.text.startsWith('<<', this.index) && !this.text.startsWith('<<<', this.index)) {
				this.readHeredocHeader();
				continue;
			}
			if (char === '$') {
				this.scanDollar();
				continue;
			}
			this.advance(1);
		}
	}

	private advance(count: number): void {
		for (let step = 0; step < count && this.index < this.text.length; step++) {
			if (this.text[this.index] === '\n') {
				this.line++;
			}
			this.index++;
		}
	}

	// A `#` starts a comment only where a word starts.
	private atWordStart(): boolean {
		if (this.index === 0) {
			return true;
		}
		return /[\s;&|(]/.test(this.text[this.index - 1]);
	}

	private skipToNewline(): void {
		while (this.index < this.text.length && this.text[this.index] !== '\n') {
			this.index++;
		}
	}

	private skipSingleQuoted(): void {
		this.advance(1);
		while (this.index < this.text.length && this.text[this.index] !== "'") {
			this.advance(1);
		}
		this.advance(1);
	}

	// Inside double quotes a `$` still expands and a `'` is an ordinary character.
	private scanDoubleQuoted(): void {
		this.advance(1);
		while (this.index < this.text.length && this.text[this.index] !== '"') {
			if (this.text[this.index] === '\\') {
				this.advance(2);
				continue;
			}
			if (this.text[this.index] === '$') {
				this.scanDollar();
				continue;
			}
			this.advance(1);
		}
		this.advance(1);
	}

	private scanDollar(): void {
		const next = this.text[this.index + 1];
		if (next === undefined) {
			this.advance(1);
			return;
		}
		if (next === '(') {
			// `$((` is arithmetic, where a bare name is a reference this lexer
			// does not follow. `$(` is a command substitution, which is a script.
			if (this.text[this.index + 2] === '(') {
				this.skipBalanced('(', ')');
				return;
			}
			this.advance(2);
			let depth = 1;
			const start = this.index;
			this.scan(() => {
				if (this.index >= this.text.length) {
					return true;
				}
				const here = this.text[this.index];
				if (here === '(') {
					depth++;
				}
				if (here === ')') {
					depth--;
					if (depth === 0) {
						return true;
					}
				}
				return false;
			});
			if (this.index === start && depth === 1) {
				this.advance(1);
			}
			this.advance(1);
			return;
		}
		if (next === '{') {
			this.scanBraced();
			return;
		}
		if (isNameStart(next)) {
			const line = this.line;
			this.advance(1);
			let name = '';
			while (this.index < this.text.length && isNameChar(this.text[this.index])) {
				name += this.text[this.index];
				this.advance(1);
			}
			this.refs.push({name, line});
			return;
		}
		if (/[0-9]/.test(next) || SPECIAL.has(next)) {
			this.advance(2);
			return;
		}
		this.advance(1);
	}

	// `${...}`: the name, then whatever follows it decides if it is guarded.
	private scanBraced(): void {
		const line = this.line;
		const close = this.matchingBrace(this.index + 1);
		const body = this.text.slice(this.index + 2, close);
		this.advance(close - this.index + 1);

		// `${#NAME}` still reads NAME. `${!x}` and `${NAME[@]}` do too, but an
		// indirect name is not knowable, so it is left alone.
		const stripped = body.startsWith('#') ? body.slice(1) : body;
		if (stripped.startsWith('!')) {
			return;
		}
		const match = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(stripped);
		if (!match) {
			return;
		}
		const rest = stripped.slice(match[1].length).replace(/^\[[^\]]*\]/, '');
		if (operatorGuards(rest)) {
			return;
		}
		this.refs.push({name: match[1], line});
	}

	private matchingBrace(open: number): number {
		let depth = 0;
		for (let cursor = open; cursor < this.text.length; cursor++) {
			if (this.text[cursor] === '{') {
				depth++;
			}
			if (this.text[cursor] === '}') {
				depth--;
				if (depth === 0) {
					return cursor;
				}
			}
		}
		return this.text.length;
	}

	private skipBalanced(open: string, close: string): void {
		let depth = 0;
		while (this.index < this.text.length) {
			const char = this.text[this.index];
			if (char === open) {
				depth++;
			}
			if (char === close) {
				depth--;
				if (depth === 0) {
					this.advance(1);
					return;
				}
			}
			this.advance(1);
		}
	}

	// `<<DELIM`, `<<-DELIM`, `<<'DELIM'`. A quoted delimiter turns expansion off.
	private readHeredocHeader(): void {
		this.advance(2);
		if (this.text[this.index] === '-') {
			this.advance(1);
		}
		while (this.index < this.text.length && /[ \t]/.test(this.text[this.index])) {
			this.advance(1);
		}
		let expands = true;
		let delimiter = '';
		const quote = this.text[this.index];
		if (quote === "'" || quote === '"') {
			expands = false;
			this.advance(1);
			while (this.index < this.text.length && this.text[this.index] !== quote) {
				delimiter += this.text[this.index];
				this.advance(1);
			}
			this.advance(1);
		} else {
			while (this.index < this.text.length && /[A-Za-z0-9_.\-]/.test(this.text[this.index])) {
				delimiter += this.text[this.index];
				this.advance(1);
			}
		}
		if (delimiter !== '') {
			this.pending.push({delimiter, expands});
		}
	}

	// At a newline every heredoc opened on that line takes its body.
	private drainHeredocs(): void {
		while (this.pending.length > 0) {
			const doc = this.pending.shift() as Heredoc;
			const body: string[] = [];
			const firstLine = this.line;
			while (this.index < this.text.length) {
				let lineEnd = this.text.indexOf('\n', this.index);
				if (lineEnd === -1) {
					lineEnd = this.text.length;
				}
				const raw = this.text.slice(this.index, lineEnd);
				this.advance(lineEnd - this.index + 1);
				if (raw.trim() === doc.delimiter) {
					break;
				}
				body.push(raw);
			}
			if (!doc.expands) {
				continue;
			}
			// The body expands like a double-quoted string.
			const inner = new Lexer(body.join('\n'));
			inner.run();
			for (const ref of inner.refs) {
				this.refs.push({name: ref.name, line: firstLine + ref.line - 1});
			}
		}
	}
}

// Every assignment the script makes. Position is not tracked on purpose: a name
// a function assigns is in scope for a caller written above it, and reporting
// on order would fail those scripts for no reason.
const ASSIGNMENT_PATTERNS: RegExp[] = [
	/(?:^|[\s;&|(])(?:export\s+|local\s+|readonly\s+|typeset\s+|declare\s+(?:-[A-Za-z]+\s+)*)?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/g,
	/(?:^|[\s;&|(])for\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:in\b|;|$)/gm,
	/(?:^|[\s;&|(])(?:local|export|readonly|declare|typeset)\s+(?:-[A-Za-z]+\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*(?:$|[\s;&|)])/gm,
	/(?:^|[\s;&|(])getopts\s+\S+\s+([A-Za-z_][A-Za-z0-9_]*)/g,
	// `${NAME:=default}` and `${NAME=default}` assign as well as read.
	/\$\{([A-Za-z_][A-Za-z0-9_]*):?=/g
];

// A `read` flag that takes the word after it. `-a NAME` names an array, and the
// rest take a value, so only `-a` contributes a name.
const READ_FLAG_TAKES_WORD = 'adinNptuOsCc';

// Every name a `read` gives a value. Walking the words is what tells a flag's
// argument apart from a target: `read -r line` names `line`, and a regex that
// lets a flag's optional argument float reads `-r line` as the flag instead.
function readTargets(script: string): string[] {
	const names: string[] = [];
	// `mapfile`/`readarray` name their array the same way, with `-d -n -O -s -u -C -c`
	// as the flags that take a word.
	const commands = [
		...script.matchAll(/(?:^|[\s;&|(])read\b([^\n;&|<>()]*)/g),
		...script.matchAll(/(?:^|[\s;&|(])(?:mapfile|readarray)\b([^\n;&|<>()]*)/g)
	];
	for (const command of commands) {
		const words = command[1].split(/\s+/).filter(word => word !== '');
		for (let index = 0; index < words.length; index++) {
			const word = words[index];
			if (!word.startsWith('-')) {
				if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
					names.push(word);
				}
				continue;
			}
			const last = word.slice(-1);
			if (!READ_FLAG_TAKES_WORD.includes(last)) {
				continue;
			}
			index++;
			if (last === 'a' && index < words.length && /^[A-Za-z_][A-Za-z0-9_]*$/.test(words[index])) {
				names.push(words[index]);
			}
		}
	}
	return names;
}

function collectAssignments(script: string): Set<string> {
	const names = new Set<string>();
	for (const pattern of ASSIGNMENT_PATTERNS) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(script)) !== null) {
			names.add(match[1]);
			// A zero-width match would spin forever.
			if (match.index === pattern.lastIndex) {
				pattern.lastIndex++;
			}
		}
	}
	for (const name of readTargets(script)) {
		names.add(name);
	}
	return names;
}

const NOUNSET_ON = /(?:^|[\s;&|(])set\s+(?:-[a-zA-Z]*u[a-zA-Z]*\b|-o\s+nounset\b)/m;
const NOUNSET_OFF = /(?:^|[\s;&|(])set\s+(?:\+[a-zA-Z]*u[a-zA-Z]*\b|\+o\s+nounset\b)/m;

export function scanShell(script: string): ShellScan {
	const text = blankExpressions(script);
	const lexer = new Lexer(text);
	lexer.run();
	return {
		refs: lexer.refs,
		assigned: collectAssignments(text),
		nounset: NOUNSET_ON.test(text),
		nounsetOff: NOUNSET_OFF.test(text)
	};
}
