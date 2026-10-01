// ste-lint holds no prose rule of its own. slopfix owns every rule, and this module runs it.

import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The rules this action enforces, by slopfix rule ID.
export const RULES = [
	'wrap/hard-wrap',
	'ste/contraction',
	'ste/modal',
	'ste/semicolon',
	'ste/comma-splice',
	'ste/sentence-length',
];

// An APE runs on every platform, so the linux/amd64 build serves them all.
export const SLOPFIX_URL = 'https://dl.pazer.build/slopfix?os=linux&arch=amd64';

export interface Finding {
	id: string;
	line: number;
	rule: string;
	detail?: string;
	fix?: string;
}

// Downloads slopfix and answers its path. A failed download fails the run.
export async function fetchSlopfix(url = process.env.SLOPFIX_URL || SLOPFIX_URL): Promise<string> {
	const response = await fetch(url, {redirect: 'follow'});
	if (!response.ok) throw new Error(`could not download slopfix from ${url}: HTTP ${response.status}`);
	const body = Buffer.from(await response.arrayBuffer());
	if (body.subarray(0, 2).toString() !== 'MZ') throw new Error(`${url} did not serve an APE`);
	const path = join(mkdtempSync(join(tmpdir(), 'ste-lint-')), 'slopfix');
	writeFileSync(path, body);
	chmodSync(path, 0o755);
	return path;
}

// Runs `slopfix report` on one document and answers its findings.
export function report(binary: string, name: string, text: string): Finding[] {
	const [command, args] = process.platform === 'win32' ? [binary, [] as string[]] : ['sh', [binary]];
	const out = execFileSync(command, [...args, 'report', '--path', name, '--only', RULES.join(',')], {
		encoding: 'utf-8',
		input: text,
		maxBuffer: Infinity,
	});
	return parseReport(out);
}

export function parseReport(out: string): Finding[] {
	const parsed = JSON.parse(out) as {findings?: Finding[] | null};
	return parsed.findings ?? [];
}

// slopfix places a finding on the first line of its paragraph. It belongs to the change
// when the change touched any line of that paragraph.
export function paragraphEnd(lines: string[], line: number): number {
	let end = line;
	while (end < lines.length && lines[end].trim() !== '' && !BLOCK_START.test(lines[end])) end++;
	return end;
}

// A list item, a heading and a fence each start a block of their own, as slopfix reads them.
const BLOCK_START = /^\s*([-*+]|\d+[.)])\s|^\s*(#|```|~~~)/;

export function onTouched(findings: Finding[], lines: string[], touched: Set<number>): Finding[] {
	return findings.filter((f) => {
		for (let n = f.line; n <= paragraphEnd(lines, f.line); n++) {
			if (touched.has(n)) return true;
		}
		return false;
	});
}

export function describe(name: string, f: Finding): string {
	const detail = f.detail ? ` "${f.detail}"` : '';
	const fix = f.fix ? ` ${f.fix}` : '';
	return `${name}:${f.line}: [${f.id}] ${f.rule}${detail}.${fix}`;
}
