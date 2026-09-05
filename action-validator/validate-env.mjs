// A composite `run:` step that sets `-u` and reads a variable nothing declares
// dies on its first line, in every repo that calls the action.
//
// The schema validator cannot see this: the YAML is valid either way. The
// declaration and the read live in different keys, so an edit that removes an
// input can leave the script that reads it behind, and the file still passes
// every check there was. That is exactly how common-checks lost its `exclude`
// input while keeping `$EXCLUDE`.
//
// This is a regex walk rather than a YAML parse, the same as no-tests-in-yaml:
// `run:` and `env:` mean the same thing at every depth, and a file worth
// rejecting may also be a file a parser rejects.

// Variables the runner always exports. A script may read any of these without
// declaring anything.
const RUNNER_PROVIDED =
	/^(GITHUB_|RUNNER_|ACTIONS_|INPUT_|CI$|HOME$|PATH$|PWD$|USER$|SHELL$|TMPDIR$|TEMP$|TMP$|LANG$|LC_|OSTYPE$|HOSTNAME$)/;

// A step, as the `- ` item that introduces it plus everything indented under it.
function steps(lines) {
	const found = [];
	for (let i = 0; i < lines.length; i++) {
		const match = /^(\s*)-\s/.exec(lines[i]);
		if (!match) continue;
		const indent = match[1].length;
		let end = i + 1;
		for (; end < lines.length; end++) {
			if (lines[end].trim() === '') continue;
			if (lines[end].search(/\S/) <= indent) break;
		}
		found.push({start: i, end, keyColumn: indent + 2});
		i = end - 1;
	}
	return found;
}

// The body of a block scalar introduced by `key:` at the step's key column. The
// first line of a step carries its key past the `- `, so both spellings open one.
function blockAt(lines, step, key) {
	const column = step.keyColumn;
	const opener = new RegExp(`^(?:\\s{${column}}|\\s{${column - 2}}-\\s)${key}:\\s*(?:[|>][+-]?\\d*)?\\s*$`);
	for (let i = step.start; i < step.end; i++) {
		if (!opener.test(lines[i])) continue;
		const body = [];
		for (let j = i + 1; j < step.end; j++) {
			if (lines[j].trim() === '') {
				body.push({line: j + 1, text: ''});
				continue;
			}
			if (lines[j].search(/\S/) <= step.keyColumn) break;
			body.push({line: j + 1, text: lines[j]});
		}
		return body;
	}
	return null;
}

// The names an `env:` mapping on this step declares.
function declaredEnv(lines, step) {
	const body = blockAt(lines, step, 'env');
	const names = new Set();
	for (const {text} of body ?? []) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(text);
		if (match) names.add(match[1]);
	}
	return names;
}

// Names the script itself sets before anything reads them.
function assignedInScript(text) {
	const names = new Set();
	const patterns = [
		/^\s*(?:local\s+|export\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_][A-Za-z0-9_]*)\+?=/gm,
		/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g,
		/\bread\s+(?:-\w+\s+)*([A-Za-z_][A-Za-z0-9_]*)/g,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) names.add(match[1]);
	}
	return names;
}

// A script runs under `set -u` when it asks for it: `set -u`, `set -eu`,
// `set -euo pipefail`. Only the short forms bunch, so `-o nounset` is read too.
function setsNounset(text) {
	return /^\s*set\s+(?:-[a-zA-Z]*u[a-zA-Z]*\b|-o\s+nounset\b)/m.test(text);
}

// Everything a line reads that would abort under `set -u`. `${VAR:-}` and its
// siblings supply a default, so they are safe; `${#VAR}` is not.
function readsOn(line) {
	// A GitHub expression is substituted before bash ever sees the line, and a
	// single-quoted span is literal text - an awk program, mostly.
	const bare = line.replace(/\$\{\{[^}]*\}\}/g, '').replace(/'[^']*'/g, "''");
	const names = [];
	for (const match of bare.matchAll(/\$\{?#?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
		// A brace form that stopped short of its `}` is followed by an operator.
		// `:-`, `-`, `:+`, `+`, `:=` and `:?` each name what to use instead, so
		// the read cannot abort. `${#NAME}` closes its brace and still can.
		const closed = match[0].endsWith('}');
		const after = bare.slice(match.index + match[0].length);
		if (match[0].startsWith('${') && !closed && /^[:\-+=?]/.test(after)) continue;
		names.push(match[1]);
	}
	return names;
}

// Every read in this file that nothing declares. One entry per read.
export function findUndeclared(content) {
	const lines = content.split(/\r?\n/);
	const findings = [];
	for (const step of steps(lines)) {
		const script = blockAt(lines, step, 'run');
		if (!script) continue;
		const text = script.map((entry) => entry.text).join('\n');
		if (!setsNounset(text)) continue;

		const known = new Set([...declaredEnv(lines, step), ...assignedInScript(text)]);
		for (const {line, text: source} of script) {
			for (const name of readsOn(source)) {
				if (known.has(name) || RUNNER_PROVIDED.test(name)) continue;
				findings.push({line, name, evidence: source.trim()});
			}
		}
	}
	return findings;
}

async function main(files) {
	const {readFile} = await import('node:fs/promises');
	let failed = false;
	for (const file of files) {
		const findings = findUndeclared(await readFile(file, 'utf8'));
		for (const {line, name, evidence} of findings) {
			failed = true;
			console.error(
				`${file}:${line}: ${name} is read under \`set -u\` but no \`env:\` on this step declares it, ` +
					`and nothing in the script assigns it: ${evidence}`,
			);
		}
	}
	if (failed) {
		console.error('\nDeclare it in the step\'s `env:`, or give the read a default with ${NAME:-}.');
		process.exit(1);
	}
	console.log(`env: ${files.length} file(s) checked, every read declared`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main(process.argv.slice(2));
}
