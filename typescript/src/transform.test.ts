import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MAIN_FN, transformScript, TransformedScript } from './transform';

const WRAPPER_OPEN = `export async function ${MAIN_FN}() {`;

function emitted(script: string): TransformedScript & { lines: string[]; wrapperAt: number } {
	const t = transformScript(script);
	const lines = t.text.split('\n');
	const wrapperAt = lines.indexOf(WRAPPER_OPEN);
	assert.notEqual(wrapperAt, -1, `wrapper missing in:\n${t.text}`);
	return { ...t, lines, wrapperAt };
}

function lineIndexOf(lines: string[], needle: string): number {
	const i = lines.findIndex((l) => l.includes(needle));
	assert.notEqual(i, -1, `expected a line containing ${JSON.stringify(needle)} in:\n${lines.join('\n')}`);
	return i;
}

describe('transformScript', () => {
	it('wraps a plain script in the async function with an identity line map', () => {
		const t = emitted('core.info("one");\ncore.info("two");');
		assert.equal(t.wrapperAt, 0);
		assert.deepEqual(t.lineMap, [-1, 0, 1, -1]);
		assert.equal(t.lines[t.lines.length - 2], '}');
	});

	it('hoists imports above the wrapper, body statements inside', () => {
		const t = emitted('import { x } from "y";\ncore.info(String(x));');
		assert.ok(lineIndexOf(t.lines, 'import { x }') < t.wrapperAt);
		assert.ok(lineIndexOf(t.lines, 'core.info') > t.wrapperAt);
	});

	it('hoists every export/import form', () => {
		const t = emitted(
			[
				'export const VERSION = "1.0.0";',
				'export default 42;',
				'export type T = number;',
				'export { VERSION as V };',
				'import fs2 = require("fs");',
				'void fs2;',
			].join('\n'),
		);
		for (const needle of ['export const VERSION', 'export default 42', 'export type T', 'export { VERSION as V }', 'import fs2 = require']) {
			assert.ok(lineIndexOf(t.lines, needle) < t.wrapperAt, `${needle} should be hoisted`);
		}
		assert.ok(lineIndexOf(t.lines, 'void fs2;') > t.wrapperAt);
	});

	it('hoists module-only syntax: declare const, declare global, namespaces', () => {
		const t = emitted(
			[
				'declare const injected: number;',
				'declare global { interface G { n: number } }',
				'namespace N { export const k = 1; }',
				'core.info(String(injected + N.k));',
			].join('\n'),
		);
		for (const needle of ['declare const injected', 'declare global', 'namespace N']) {
			assert.ok(lineIndexOf(t.lines, needle) < t.wrapperAt, `${needle} should be hoisted`);
		}
		assert.ok(lineIndexOf(t.lines, 'core.info') > t.wrapperAt);
	});

	it('splits two statements sharing a line across sections, mapping both to it', () => {
		const t = emitted('import a from "b"; const x = a;');
		const importAt = lineIndexOf(t.lines, 'import a from "b";');
		const bodyAt = lineIndexOf(t.lines, 'const x = a;');
		assert.ok(importAt < t.wrapperAt && bodyAt > t.wrapperAt);
		assert.equal(t.lineMap[importAt], 0);
		assert.equal(t.lineMap[bodyAt], 0);
	});

	it('keeps leading comments (e.g. @ts-ignore) attached to the statement they precede', () => {
		const t = emitted('// @ts-ignore\nimport a from "b";\n// body comment\nconst x = a;');
		assert.equal(t.lines[lineIndexOf(t.lines, 'import a from "b";') - 1], '// @ts-ignore');
		assert.equal(t.lines[lineIndexOf(t.lines, 'const x = a;') - 1], '// body comment');
	});

	it('neutralizes a shebang without shifting positions', () => {
		const t = emitted('#!/usr/bin/env -S npx tsx\nimport a from "b";\nconst x = a;');
		assert.equal(t.lines[0], '///usr/bin/env -S npx tsx');
		assert.equal(t.lineMap[0], 0);
		assert.equal(t.lineMap[lineIndexOf(t.lines, 'import a from "b";')], 1);
		assert.equal(t.lineMap[lineIndexOf(t.lines, 'const x = a;')], 2);
	});

	it('strips a leading BOM', () => {
		const t = emitted('\uFEFF' + 'core.info("x");');
		assert.equal(t.lines[t.wrapperAt + 1], 'core.info("x");');
	});

	it('handles empty and comment-only scripts', () => {
		for (const script of ['', '// nothing here\n/* still nothing */']) {
			const t = emitted(script);
			assert.equal(t.text, `${WRAPPER_OPEN}\n}\n`);
			assert.deepEqual(t.lineMap, [-1, -1]);
		}
	});

	it('maps body lines correctly when imports are hoisted from the top', () => {
		const t = emitted('import * as fsp from "node:fs/promises";\ncore.info("ok");\nconst n: number = "bad";');
		assert.equal(t.lineMap[lineIndexOf(t.lines, 'const n: number')], 2);
		assert.equal(t.lineMap[lineIndexOf(t.lines, 'core.info("ok")')], 1);
	});

	it('preserves relative order within each section for interleaved statements', () => {
		const t = emitted(
			['const a = 1;', 'import i1 from "m1";', 'const b = a;', 'import i2 from "m2";', 'void [i1, i2, b];'].join('\n'),
		);
		assert.ok(lineIndexOf(t.lines, 'import i1') < lineIndexOf(t.lines, 'import i2'));
		assert.ok(lineIndexOf(t.lines, 'import i2') < t.wrapperAt);
		assert.ok(t.wrapperAt < lineIndexOf(t.lines, 'const a = 1;'));
		assert.ok(lineIndexOf(t.lines, 'const a = 1;') < lineIndexOf(t.lines, 'const b = a;'));
	});
});
