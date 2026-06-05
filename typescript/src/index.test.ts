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

	it('rejects top-level ESM import (use require / dynamic import instead)', async () => {
		// Wrapping the script in a function means top-level `import` is no longer
		// valid — this is the documented tradeoff. It must fail type-checking.
		const { exitCode, stdout } = await runAction(
			'import * as c from "@actions/core"; c.info("x");'
		);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('TypeScript validation failed'));
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
