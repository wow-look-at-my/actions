import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

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

	it('supports import with top-level await', async () => {
		const { stdout, exitCode } = await runAction(`
			import * as core2 from "@actions/core";
			const val = await Promise.resolve("imported");
			core2.info("got:" + val);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('got:imported'));
	});

	it('supports import of node built-in modules', async () => {
		const { stdout, exitCode } = await runAction(`
			import * as nodePath from "path";
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
});
