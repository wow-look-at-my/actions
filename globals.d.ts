// Ambient declarations injected by the typescript action.

declare const core: typeof import('@actions/core');
declare const exec: typeof import('@actions/exec');
declare const io: typeof import('@actions/io');

type ShellArg = string | number | boolean | null | undefined | string[];

/**
 * Thenable command builder returned by `$`. Awaiting executes the command.
 * Chain methods to set options before awaiting.
 */
interface ExecBuilder extends PromiseLike<number> {
	/** Pipe data to the command's stdin. */
	input(data: Buffer | string): ExecBuilder;
	/** Set the working directory. */
	cwd(dir: string): ExecBuilder;
	/** Suppress stdout/stderr. */
	silent(): ExecBuilder;
}

/**
 * Execute a command via tagged template. Static parts are split by whitespace;
 * interpolated values are passed as individual arguments (never shell-split).
 *
 * - string/number -> single argument
 * - string[] -> expanded as multiple arguments
 * - falsy (false, null, undefined, '') -> skipped
 *
 * Throws on non-zero exit. Chain .input()/.cwd()/.silent() before awaiting.
 */
declare function $(strings: TemplateStringsArray, ...values: ShellArg[]): ExecBuilder;
declare const fs: typeof import('fs');
declare const path: typeof import('path');
declare const os: typeof import('os');
declare const child_process: typeof import('child_process');
declare const util: typeof import('util');

declare const context: import('@actions/github/lib/context').Context;

interface OctokitInstance {
	rest: any;
	graphql: any;
	paginate: any;
	request: any;
	hook: any;
	auth: any;
	log: { debug: (...args: any[]) => any; info: (...args: any[]) => any; warn: (...args: any[]) => any; error: (...args: any[]) => any };
}
declare function octokit(token: string, options?: Record<string, any>): OctokitInstance;

interface RunnerContext {
	os: 'Linux' | 'macOS' | 'Windows' | string;
	arch: 'X86' | 'X64' | 'ARM' | 'ARM64' | string;
	name: string;
	environment: 'github-hosted' | 'self-hosted' | string;
	tool_cache: string;
	temp: string;
	debug: string;
}

interface JobContext {
	status: 'success' | 'failure' | 'cancelled' | string;
	container?: { id: string; network: string };
	services?: Record<string, { id: string; ports: Record<string, string>; network: string }>;
}

interface StrategyContext {
	fail_fast: boolean;
	job_index: number;
	job_total: number;
	max_parallel: number;
}

interface StepResult {
	conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | string;
	outcome: 'success' | 'failure' | 'cancelled' | 'skipped' | string;
	outputs: Record<string, string>;
}

interface NeedsResult {
	result: 'success' | 'failure' | 'cancelled' | 'skipped' | string;
	outputs: Record<string, string>;
}

declare const github: Record<string, any>;
declare const env: Record<string, string>;
declare const runner: RunnerContext;
declare const job: JobContext;
declare const steps: Record<string, StepResult>;
declare const needs: Record<string, NeedsResult>;
declare const vars: Record<string, string>;
declare const secrets: Record<string, string>;
declare const inputs: Record<string, any>;
declare const strategy: StrategyContext;
declare const matrix: Record<string, any>;
