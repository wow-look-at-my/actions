import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

const execFileAsync = promisify(execFile);
const DIST = path.join(__dirname, '..', 'dist', 'index.js');

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function runAction(script: string, env: Record<string, string> = {}): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execFileAsync('node', [DIST], {
			env: { ...process.env, INPUT_SCRIPT: script, ...env },
			timeout: 15000,
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (err: any) {
		return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.code ?? 1 };
	}
}

// Parse the heredoc-style $GITHUB_OUTPUT file that @actions/core writes:
//   <name><<ghadelimiter_<uuid>\n<value>\nghadelimiter_<uuid>\n
function parseGithubOutput(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	const lines = raw.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(.+?)<<(ghadelimiter_\S+)$/);
		if (!m) continue;
		const [, key, delim] = m;
		const value: string[] = [];
		for (i++; i < lines.length && lines[i] !== delim; i++) value.push(lines[i]);
		out[key] = value.join('\n');
	}
	return out;
}

// Run the action with a real $GITHUB_OUTPUT file so the `result` output is observable.
async function runActionWithOutputs(
	script: string,
	env: Record<string, string> = {},
): Promise<RunResult & { outputs: Record<string, string> }> {
	const outFile = path.join(os.tmpdir(), `gh-output-${process.pid}-${Math.random().toString(36).slice(2)}`);
	fs.writeFileSync(outFile, '');
	try {
		const res = await runAction(script, { ...env, GITHUB_OUTPUT: outFile });
		return { ...res, outputs: parseGithubOutput(fs.readFileSync(outFile, 'utf-8')) };
	} finally {
		fs.rmSync(outFile, { force: true });
	}
}

describe('typescript action', () => {
	it('executes a basic script', async () => {
		const { stdout, exitCode } = await runAction('core.info("hello world")');
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('hello world'));
	});

	it('supports top-level await', async () => {
		const { stdout, exitCode } = await runAction(
			'const x = await Promise.resolve(42); core.info("value:" + x)'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('value:42'));
	});

	it('supports top-level await with async operations', async () => {
		const { stdout, exitCode } = await runAction(`
			const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
			await delay(10);
			core.info("after-await");
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('after-await'));
	});

	it('runs top-level await interleaved with statements (no IIFE wrapper needed)', async () => {
		// The action's promise: write `await` at the top level alongside ordinary
		// statements and control flow — no `(async () => { ... })()` ceremony.
		// As a plain CommonJS module this would need an IIFE to await; here the
		// script is the body of the action's async function, so it just runs.
		const { stdout, exitCode } = await runAction(`
			core.info("start");
			const first = await Promise.resolve(10);
			let total = first;
			for (const n of [20, 30]) {
				total += await Promise.resolve(n);
			}
			core.info("total:" + total);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('start'));
		assert.ok(stdout.includes('total:60'));
	});

	it('supports a bare top-level return (TS1108 regression)', async () => {
		// A top-level `return` must type-check and run — it is legal inside the
		// async-function body the script is wrapped in. Before the fix this
		// failed type-check with "TS1108: A 'return' statement can only be used
		// within a function body."
		const { stdout, exitCode } = await runAction(`
			const skip = false;
			if (skip) return;
			core.info("did-not-skip");
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('did-not-skip'));
	});

	it('exposes a top-level return value as the result output', async () => {
		const { outputs, exitCode } = await runActionWithOutputs(`
			const sum = 1 + 2;
			core.info("computed");
			return { sum, label: "ok" };
		`);
		assert.equal(exitCode, 0);
		assert.equal(outputs.result, '{"sum":3,"label":"ok"}');
	});

	it('combines top-level await and return into the result output', async () => {
		const { outputs, exitCode } = await runActionWithOutputs(
			'const v = await Promise.resolve(7); return v * 6;'
		);
		assert.equal(exitCode, 0);
		assert.equal(outputs.result, '42');
	});

	it('supports dynamic import() with await', async () => {
		const { stdout, exitCode } = await runAction(`
			const core2 = await import("@actions/core");
			core2.info("dynamic:imported");
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('dynamic:imported'));
	});

	it('supports require of node built-in modules', async () => {
		const { stdout, exitCode } = await runAction(`
			const nodePath = require("path");
			const joined = await Promise.resolve(nodePath.join("a", "b"));
			core.info("path:" + joined);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('path:a/b') || stdout.includes('path:a\\b'));
	});

	it('supports multiple awaits', async () => {
		const { stdout, exitCode } = await runAction(`
			const a = await Promise.resolve(1);
			const b = await Promise.resolve(2);
			const c = await Promise.resolve(a + b);
			core.info("sum:" + c);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('sum:3'));
	});

	it('propagates errors from awaited promises', async () => {
		const { stdout, exitCode } = await runAction(
			'await Promise.reject(new Error("boom"))'
		);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('boom'));
	});

	it('fails on type errors', async () => {
		const { stdout, exitCode } = await runAction(
			'const x: number = "not a number"'
		);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('TypeScript validation failed'));
	});

	it('maps type-error line numbers back to the user script', async () => {
		// The wrapper adds lines before the user code; diagnostics must still
		// point at the original `script:` line. The error is on line 2 here.
		const { stdout, exitCode } = await runAction(
			'core.info("line one");\nconst x: number = "nope";'
		);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('script:2:'), `expected an error on line 2, got:\n${stdout}`);
	});

	it('supports top-level ESM import of @actions modules (same instance as the global)', async () => {
		// Top-level `import` used to be rejected (TS1232) when the whole script
		// was an async-function body. Imports are now hoisted to module scope —
		// and `@actions/*` imports resolve to the action's own instances.
		const { stdout, exitCode } = await runAction(
			'import * as c from "@actions/core";\nc.info("esm:" + (c.info === core.info));'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('esm:true'));
	});

	it('supports a top-level export alone', async () => {
		const { outputs, exitCode } = await runActionWithOutputs('export const VERSION = "1.0.0";');
		assert.equal(exitCode, 0);
		assert.ok(!('result' in outputs), `expected no result output, got: ${JSON.stringify(outputs)}`);
	});

	it('combines a top-level import with a top-level return into the result output', async () => {
		// A real ES module cannot contain a top-level `return`; an async function
		// body cannot contain a top-level `import`. Both must work at once.
		const expected = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version;
		const { outputs, exitCode } = await runActionWithOutputs(`
			import { readFile } from "node:fs/promises";
			const pkg = JSON.parse(await readFile("package.json", "utf8"));
			return pkg.version;
		`);
		assert.equal(exitCode, 0);
		assert.equal(outputs.result, JSON.stringify(expected));
	});

	it('combines top-level import, injected globals, top-level await, and fetch typing', async () => {
		const { stdout, exitCode } = await runAction(
			`
			import { setTimeout as sleep } from "node:timers/promises";
			core.info(\`workspace = \${path.join(env.GITHUB_WORKSPACE ?? ".", "package.json")}\`);
			await sleep(10);
			const f: typeof fetch = fetch;
			core.info("fetch:" + typeof f);
			`,
			{ GITHUB_WORKSPACE: '/tmp/ws' }
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('workspace = /tmp/ws/package.json'));
		assert.ok(stdout.includes('fetch:function'));
	});

	it('supports a default import (esModuleInterop)', async () => {
		const { stdout, exitCode } = await runAction(
			'import assert2 from "node:assert/strict";\nassert2.equal(1 + 1, 2);\ncore.info("assert-ok");'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('assert-ok'));
	});

	it('handles the webhook-runner e2e shape: node: imports + globals + late functions + TLA', async () => {
		const { stdout, exitCode } = await runAction(`
			import { createServer } from "node:net";
			import { createHmac } from "node:crypto";
			import assert from "node:assert/strict";

			const BINARY = path.join("build", "webhook-runner");
			function freePort(): Promise<number> {
				return new Promise((resolve) => {
					const srv = createServer();
					srv.listen(0, "127.0.0.1", () => {
						const port = (srv.address() as { port: number }).port;
						srv.close(() => resolve(port));
					});
				});
			}
			const sig = createHmac("sha256", "k").update("payload").digest("hex");
			assert.equal(typeof child_process.execSync, "function");
			const port = await freePort();
			core.info("sig:" + sig.length + " port:" + port + " bin:" + BINARY);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('sig:64'));
		assert.ok(/port:\d+/.test(stdout));
	});

	it('still accepts a literal export {} marker', async () => {
		const { stdout, exitCode } = await runAction('export {};\ncore.info("legacy-marker");');
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('legacy-marker'));
	});

	it('supports top-level await in an exported const initializer', async () => {
		const { outputs, exitCode, stdout } = await runActionWithOutputs(
			'export const value = await Promise.resolve(5);\ncore.info("v:" + value);\nreturn value;'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('v:5'));
		assert.equal(outputs.result, '5');
	});

	it('maps type-error line numbers in scripts with hoisted imports', async () => {
		const { stdout, exitCode } = await runAction(
			'import * as fsp from "node:fs/promises";\ncore.info("ok:" + typeof fsp.readFile);\nconst n: number = "bad";'
		);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('script:3:'), `expected an error on line 3, got:\n${stdout}`);
	});

	it('elides type-only imports (no runtime require)', async () => {
		const { stdout, exitCode } = await runAction(
			'import type { Context } from "@actions/github/lib/context";\nconst c: Context | null = null;\ncore.info("type-ok:" + (c === null));'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('type-ok:true'));
	});

	it('treats a file input with a shebang identically to inline (import + await + return)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-action-test-'));
		fs.writeFileSync(
			path.join(dir, 'script.ts'),
			[
				'#!/usr/bin/env -S npx tsx',
				'import { setTimeout as sleep } from "node:timers/promises";',
				'await sleep(5);',
				'core.info("from-file");',
				'return 7;',
			].join('\n')
		);
		try {
			const { outputs, exitCode, stdout } = await runActionWithOutputs('', {
				INPUT_FILE: 'script.ts',
				GITHUB_WORKSPACE: dir,
			});
			assert.equal(exitCode, 0);
			assert.ok(stdout.includes('from-file'));
			assert.equal(outputs.result, '7');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('provides workflow contexts', async () => {
		const { stdout, exitCode } = await runAction(
			'core.info("actor:" + github.actor)',
			{ GITHUB_ACTOR: 'testuser' }
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('actor:testuser'));
	});

	it('supports require of @actions modules', async () => {
		const { stdout, exitCode } = await runAction(`
			const c = require("@actions/core");
			const val = await Promise.resolve("required");
			c.info("req:" + val);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('req:required'));
	});

	it('provides pre-authenticated octokit instance', async () => {
		const { stdout, exitCode } = await runAction(
			'core.info("octokit-rest:" + typeof octokit.rest)',
			{ GITHUB_TOKEN: 'fake-token-for-test' }
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('octokit-rest:object'));
	});

	it('octokit(token) emits deprecation warning and still works', async () => {
		const { stdout, exitCode } = await runAction(
			'const c = octokit("fake"); core.info("type:" + typeof c.rest)'
		);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('type:object'));
		assert.ok(stdout.toLowerCase().includes('deprecated'));
	});
});
