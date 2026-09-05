// The parts of a workflow or action file this check needs: every `run:` script,
// and every name something in the file binds into the environment around it.
// A regex walk, not a YAML parse -- `run:` and `env:` mean the same thing at
// every depth, and a file this action rejects may be one a parser rejects too.

export interface RunStep {
	// The line the script's first content line sits on.
	startLine: number;
	script: string;
	// `shell:` as written, or undefined when the step does not say.
	shell?: string;
	// Names this step's own `env:` binds.
	stepEnv: Set<string>;
}

interface Line {
	text: string;
	indent: number;
	// Where this line's first KEY sits. A sequence item carries its key past the
	// dash, so `- run:` is a sibling of the `env:` two columns further in.
	keyIndent: number;
	item: boolean;
	blank: boolean;
}

function measure(content: string): Line[] {
	return content.split(/\r?\n/).map(text => {
		const first = text.search(/\S/);
		const indent = first === -1 ? 0 : first;
		const dash = /^\s*(-\s+)/.exec(text);
		return {
			text,
			indent,
			keyIndent: indent + (dash ? dash[1].length : 0),
			item: dash !== null,
			blank: first === -1
		};
	});
}

// The keys of the mapping that starts at `line`, at exactly `indent`.
function mappingKeys(lines: Line[], start: number, indent: number): string[] {
	const names: string[] = [];
	for (let cursor = start; cursor < lines.length; cursor++) {
		const line = lines[cursor];
		if (line.blank) {
			continue;
		}
		if (line.indent < indent) {
			break;
		}
		if (line.indent > indent) {
			continue;
		}
		const match = /^\s*(?:-\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*:/.exec(line.text);
		if (match) {
			names.push(match[1]);
		}
	}
	return names;
}

// Every name any `env:` block in the file binds. Scope is deliberately the whole
// file: a workflow's env, a job's env and a step's env all land here. Reading a
// name one step over is a different defect, and failing a build over it would
// need a real YAML scope walk to be trustworthy.
export function envNames(content: string): Set<string> {
	const lines = measure(content);
	const names = new Set<string>();
	for (let index = 0; index < lines.length; index++) {
		const match = /^(\s*)(-\s+)?env:\s*(.*)$/.exec(lines[index].text);
		if (!match) {
			continue;
		}
		const keyIndent = match[1].length + (match[2] ? match[2].length : 0);
		const inline = match[3].trim();
		if (inline.startsWith('{')) {
			for (const key of inline.matchAll(/([A-Za-z_][A-Za-z0-9_.-]*)\s*:/g)) {
				names.add(key[1]);
			}
			continue;
		}
		// The block's own keys sit one level in from `env:`.
		let childIndent = -1;
		for (let cursor = index + 1; cursor < lines.length; cursor++) {
			if (lines[cursor].blank) {
				continue;
			}
			if (lines[cursor].indent <= keyIndent) {
				break;
			}
			childIndent = lines[cursor].indent;
			break;
		}
		if (childIndent === -1) {
			continue;
		}
		for (const key of mappingKeys(lines, index + 1, childIndent)) {
			names.add(key);
		}
	}
	return names;
}

// A composite action's inputs reach its own run steps as INPUT_<NAME>.
export function inputEnvNames(content: string): Set<string> {
	const lines = measure(content);
	const names = new Set<string>();
	for (let index = 0; index < lines.length; index++) {
		const match = /^(\s*)inputs:\s*$/.exec(lines[index].text);
		if (!match) {
			continue;
		}
		const keyIndent = match[1].length;
		let childIndent = -1;
		for (let cursor = index + 1; cursor < lines.length; cursor++) {
			if (lines[cursor].blank) {
				continue;
			}
			if (lines[cursor].indent <= keyIndent) {
				break;
			}
			childIndent = lines[cursor].indent;
			break;
		}
		if (childIndent === -1) {
			continue;
		}
		for (const key of mappingKeys(lines, index + 1, childIndent)) {
			names.add(`INPUT_${key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`);
		}
	}
	return names;
}

// Names an earlier step writes to $GITHUB_ENV, which bind for every step after
// it. The write is found by the redirect, on its own line or as a heredoc.
export function githubEnvNames(content: string): Set<string> {
	const lines = content.split(/\r?\n/);
	const names = new Set<string>();
	const add = (text: string): void => {
		for (const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
			names.add(match[1]);
		}
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line.includes('GITHUB_ENV')) {
			continue;
		}
		const heredoc = /<<-?\s*["']?([A-Za-z0-9_]+)["']?/.exec(line);
		if (heredoc) {
			for (let cursor = index + 1; cursor < lines.length; cursor++) {
				if (lines[cursor].trim() === heredoc[1]) {
					break;
				}
				add(lines[cursor]);
			}
			continue;
		}
		add(line);
	}
	return names;
}

// Every `run:` step, with the `shell:` and `env:` written beside it.
export function findRunSteps(content: string): RunStep[] {
	const lines = measure(content);
	const steps: RunStep[] = [];

	for (let index = 0; index < lines.length; index++) {
		const match = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(lines[index].text);
		if (!match) {
			continue;
		}
		const keyIndent = lines[index].keyIndent;
		const rest = match[1].trim();

		let startLine = index + 1;
		let script = rest;
		let end = index;
		if (/^[|>][+-]?\d*$/.test(rest)) {
			const body: string[] = [];
			let cursor = index + 1;
			for (; cursor < lines.length; cursor++) {
				if (lines[cursor].blank) {
					body.push('');
					continue;
				}
				if (lines[cursor].indent <= keyIndent) {
					break;
				}
				body.push(lines[cursor].text);
			}
			while (body.length > 0 && body[body.length - 1] === '') {
				body.pop();
			}
			startLine = index + 2;
			script = body.join('\n');
			end = cursor - 1;
		} else if (rest === '') {
			continue;
		}

		steps.push({
			startLine,
			script,
			shell: siblingShell(lines, index, end, keyIndent),
			stepEnv: siblingEnv(lines, index, end, keyIndent)
		});
		index = end;
	}

	return steps;
}

// The bounds of the step `run:` belongs to: its sibling keys sit at the same key
// indent, between the dash that opens the step and the next one.
function siblingRange(lines: Line[], runLine: number, runEnd: number, keyIndent: number): [number, number] {
	let start = runLine;
	// A `- run:` opens the step itself, so there is nothing above it to collect.
	if (!lines[runLine].item) {
		for (let cursor = runLine - 1; cursor >= 0; cursor--) {
			const line = lines[cursor];
			if (line.blank) {
				continue;
			}
			if (line.keyIndent < keyIndent) {
				break;
			}
			if (line.keyIndent === keyIndent) {
				start = cursor;
				if (line.item) {
					break;
				}
			}
		}
	}
	let end = runEnd;
	for (let cursor = runEnd + 1; cursor < lines.length; cursor++) {
		const line = lines[cursor];
		if (line.blank) {
			continue;
		}
		if (line.keyIndent < keyIndent || (line.keyIndent === keyIndent && line.item)) {
			break;
		}
		end = cursor;
	}
	return [start, end];
}

function siblingShell(lines: Line[], runLine: number, runEnd: number, keyIndent: number): string | undefined {
	const [start, end] = siblingRange(lines, runLine, runEnd, keyIndent);
	for (let cursor = start; cursor <= end; cursor++) {
		if (lines[cursor].keyIndent !== keyIndent) {
			continue;
		}
		const match = /^\s*(?:-\s+)?shell:\s*["']?([^"'\s#]+)/.exec(lines[cursor].text);
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

function siblingEnv(lines: Line[], runLine: number, runEnd: number, keyIndent: number): Set<string> {
	const [start, end] = siblingRange(lines, runLine, runEnd, keyIndent);
	const names = new Set<string>();
	for (let cursor = start; cursor <= end; cursor++) {
		if (lines[cursor].keyIndent !== keyIndent) {
			continue;
		}
		const match = /^\s*(?:-\s+)?env:\s*(.*)$/.exec(lines[cursor].text);
		if (!match) {
			continue;
		}
		const inline = match[1].trim();
		if (inline.startsWith('{')) {
			for (const key of inline.matchAll(/([A-Za-z_][A-Za-z0-9_.-]*)\s*:/g)) {
				names.add(key[1]);
			}
			continue;
		}
		for (let child = cursor + 1; child <= end; child++) {
			if (lines[child].blank) {
				continue;
			}
			if (lines[child].indent <= keyIndent) {
				break;
			}
			const key = /^\s*["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*:/.exec(lines[child].text);
			if (key) {
				names.add(key[1]);
			}
		}
	}
	return names;
}
