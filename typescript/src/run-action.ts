import { before } from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

export const execFileAsync = promisify(execFile);
export const DIST = path.join(__dirname, '..', 'dist', 'index.js');

// These tests run the shipped action, so they build it first. `ts0 test` runs before `ts0 build`.
before(() => {
	execFileSync('just', ['build'], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
});

export interface RunResult {
	/** Process stdout with the echoed script source removed. */
	stdout: string;
	/** Full process stdout, source echo included. */
	rawStdout: string;
	stderr: string;
	exitCode: number;
}

// The action opens the "Compiling script" group by echoing the (highlighted) script source.
export const SOURCE_ECHO = /^::group::Compiling script\n[\s\S]*?(?=^Type-check passed\.$|^::error::)/m;

export async function runAction(script: string, env: Record<string, string> = {}): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execFileAsync('node', [DIST], {
			env: { ...process.env, INPUT_SCRIPT: script, ...env },
			timeout: 15000,
		});
		return { stdout: stdout.replace(SOURCE_ECHO, ''), rawStdout: stdout, stderr, exitCode: 0 };
	} catch (err: unknown) {
		// execFile rejects with an Error carrying the captured streams and the exit code, which no Node type declares.
		const failure = err as { stdout?: string; stderr?: string; code?: number };
		const stdout: string = failure.stdout ?? '';
		return { stdout: stdout.replace(SOURCE_ECHO, ''), rawStdout: stdout, stderr: failure.stderr ?? '', exitCode: failure.code ?? 1 };
	}
}

// Parse the heredoc-style $GITHUB_OUTPUT file that @actions/core writes:
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
export async function runActionWithOutputs(
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
