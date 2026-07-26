import * as ts from 'typescript';

// Name of the async function the user script's body statements are wrapped in.
export const MAIN_FN = '__main';

export interface TransformedScript {
	/** Module source handed to type-checking and transpilation. */
	text: string;
	/** Emitted 0-based line -> original 0-based line; -1 for synthetic wrapper lines. */
	lineMap: number[];
}

// Statements that must (or may only) live at module scope: import/export in all
// their forms, plus namespaces / `declare module` / `declare global` (TS1234,
// TS1235 inside a function body) and `declare`-modified statements (TS1184
// inside a function body).
function isModuleScopeStatement(stmt: ts.Statement): boolean {
	if (
		ts.isImportDeclaration(stmt) ||
		ts.isImportEqualsDeclaration(stmt) ||
		ts.isExportDeclaration(stmt) ||
		ts.isExportAssignment(stmt) ||
		ts.isModuleDeclaration(stmt)
	) {
		return true;
	}
	if (ts.canHaveModifiers(stmt)) {
		const mods = ts.getModifiers(stmt);
		if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DeclareKeyword)) {
			return true;
		}
	}
	return false;
}

// Splits the user script so that top-level ESM `import`/`export` (and other
// module-only statements) stay at real module scope while everything else
// becomes the body of `export async function __main()`:
//
//   <module-scope statements, original relative order>
//   export async function __main() {
//   <remaining statements, original relative order>
//   }
//
// A module allows top-level import/export but not top-level `return`; an async
// function body allows top-level `await` and `return` but not import/export.
// Splitting gives every construct a legal home: __main's resolved value becomes
// the action's `result` output, and hoisted imports execute before the body —
// matching ESM import-hoisting semantics.
//
// __main's return type is intentionally left to inference: an explicit non-void
// type (e.g. Promise<unknown>) would make a script that never returns a value
// trip TS2355 ("must return a value").
export function transformScript(script: string): TransformedScript {
	// Strip a leading BOM so line-1 columns in diagnostics stay exact.
	if (script.charCodeAt(0) === 0xfeff) {
		script = script.slice(1);
	}
	// Neutralize a shebang (a `file:` input may be an executable script): valid
	// only at byte 0, so it cannot be re-emitted below the hoisted statements.
	// Replacing `#!` with `//` preserves every source position.
	if (ts.getShebang(script) !== undefined) {
		script = '//' + script.slice(2);
	}

	const sf = ts.createSourceFile('user-script.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

	// Tile the source into contiguous runs of same-destination statements. A
	// run covers [previous statement's end, this statement's end), so leading
	// trivia (comments, `// @ts-ignore`) travels with the statement it precedes
	// and no text is duplicated or lost — except trivia after the last
	// statement, which is only comments/whitespace and is dropped.
	interface Run {
		hoisted: boolean;
		start: number;
		end: number;
	}
	const runs: Run[] = [];
	let prevEnd = 0;
	for (const stmt of sf.statements) {
		const hoisted = isModuleScopeStatement(stmt);
		const last = runs[runs.length - 1];
		if (last && last.hoisted === hoisted) {
			last.end = stmt.end;
		} else {
			runs.push({ hoisted, start: prevEnd, end: stmt.end });
		}
		prevEnd = stmt.end;
	}

	const outLines: string[] = [];
	const lineMap: number[] = [];
	const push = (text: string, firstSrcLine: number): void => {
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			outLines.push(lines[i]);
			lineMap.push(firstSrcLine < 0 ? -1 : firstSrcLine + i);
		}
	};

	for (const run of runs) {
		if (run.hoisted) {
			push(script.slice(run.start, run.end), sf.getLineAndCharacterOfPosition(run.start).line);
		}
	}
	push(`export async function ${MAIN_FN}() {`, -1);
	for (const run of runs) {
		if (!run.hoisted) {
			push(script.slice(run.start, run.end), sf.getLineAndCharacterOfPosition(run.start).line);
		}
	}
	push('}', -1);

	return { text: outLines.join('\n') + '\n', lineMap };
}
