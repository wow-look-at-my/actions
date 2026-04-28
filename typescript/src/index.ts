import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import * as util from 'util';
import * as ts from 'typescript';

// dist/ layout produced by `just build`:
//   dist/index.js                  (bundled action)
//   dist/lib.es*.d.ts              (TypeScript standard libs)
//   dist/types/node_modules/...    (mirrored types for module resolution)
const DIST_DIR = __dirname;
const TYPES_DIR = path.join(DIST_DIR, 'types');
// Virtual file the user's wrapped script lives at. Located under TYPES_DIR
// so node module resolution finds dist/types/node_modules/* by walking up.
const VIRTUAL_FILE = path.join(TYPES_DIR, '__user-script.ts');

// Ambient declarations for the helpers injected at runtime. These names match
// the `new Function(...)` parameter list in execute() below.
const GLOBALS_DTS = `// Ambient declarations injected by the typescript action.

declare const core: typeof import('@actions/core');
declare const exec: typeof import('@actions/exec');
declare const io: typeof import('@actions/io');
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
`;

// No explicit return type on the wrapper — under strict mode that would
// reject scripts that don't have an explicit `return`. TypeScript infers
// `Promise<T | undefined>` from the body, which is what we want.
const WRAPPER_PREFIX = `${GLOBALS_DTS}\nasync function __runUserScript() {\n`;
// Number of newlines preceding the user's first line — used to remap
// diagnostic line numbers from the wrapped source back to user lines.
const WRAPPER_PREFIX_LINES = WRAPPER_PREFIX.split('\n').length - 1;
const WRAPPER_SUFFIX = '\n}\n';

function buildSource(userScript: string): string {
	return WRAPPER_PREFIX + userScript + WRAPPER_SUFFIX;
}

interface WorkflowContexts {
	github: unknown;
	env: unknown;
	runner: unknown;
	job: unknown;
	steps: unknown;
	needs: unknown;
	vars: unknown;
	secrets: unknown;
	inputs: unknown;
	strategy: unknown;
	matrix: unknown;
}

// Returns parsed JSON, or undefined if the input was unset / blank.
function maybeParseJson(name: string): unknown {
	const raw = core.getInput(name);
	if (!raw || !raw.trim()) return undefined;
	try {
		return JSON.parse(raw);
	} catch (e) {
		throw new Error(`Input '${name}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
}

// Like maybeParseJson, but defaults to {} when unset (for contexts the runner
// never exposes — vars, secrets, steps, needs, inputs, strategy, matrix).
function parseOptionalContext(name: string): unknown {
	return maybeParseJson(name) ?? {};
}

function deriveGithubContext(): Record<string, unknown> {
	const eventPath = process.env.GITHUB_EVENT_PATH;
	let event: unknown = {};
	if (eventPath) {
		try {
			event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
		} catch {
			// fall through to empty event
		}
	}
	// Mirror the shape of the workflow `github` context. Numeric fields are
	// left as the strings the runner provides — converting silently could
	// surprise a script comparing against ${{ github.run_id }} substitutions.
	return {
		event,
		event_name: process.env.GITHUB_EVENT_NAME,
		event_path: eventPath,
		actor: process.env.GITHUB_ACTOR,
		actor_id: process.env.GITHUB_ACTOR_ID,
		triggering_actor: process.env.GITHUB_TRIGGERING_ACTOR,
		repository: process.env.GITHUB_REPOSITORY,
		repository_id: process.env.GITHUB_REPOSITORY_ID,
		repository_owner: process.env.GITHUB_REPOSITORY_OWNER,
		repository_owner_id: process.env.GITHUB_REPOSITORY_OWNER_ID,
		run_id: process.env.GITHUB_RUN_ID,
		run_number: process.env.GITHUB_RUN_NUMBER,
		run_attempt: process.env.GITHUB_RUN_ATTEMPT,
		retention_days: process.env.GITHUB_RETENTION_DAYS,
		workflow: process.env.GITHUB_WORKFLOW,
		workflow_ref: process.env.GITHUB_WORKFLOW_REF,
		workflow_sha: process.env.GITHUB_WORKFLOW_SHA,
		job: process.env.GITHUB_JOB,
		job_workflow_sha: process.env.GITHUB_JOB_WORKFLOW_SHA,
		sha: process.env.GITHUB_SHA,
		ref: process.env.GITHUB_REF,
		ref_name: process.env.GITHUB_REF_NAME,
		ref_type: process.env.GITHUB_REF_TYPE,
		ref_protected: process.env.GITHUB_REF_PROTECTED,
		head_ref: process.env.GITHUB_HEAD_REF,
		base_ref: process.env.GITHUB_BASE_REF,
		workspace: process.env.GITHUB_WORKSPACE,
		api_url: process.env.GITHUB_API_URL,
		server_url: process.env.GITHUB_SERVER_URL,
		graphql_url: process.env.GITHUB_GRAPHQL_URL,
		action: process.env.GITHUB_ACTION,
		action_path: process.env.GITHUB_ACTION_PATH,
		action_ref: process.env.GITHUB_ACTION_REF,
		action_repository: process.env.GITHUB_ACTION_REPOSITORY,
		action_status: process.env.GITHUB_ACTION_STATUS,
		secret_source: process.env.GITHUB_SECRET_SOURCE,
		token: process.env.GITHUB_TOKEN,
		path: process.env.GITHUB_PATH,
		env: process.env.GITHUB_ENV,
		output: process.env.GITHUB_OUTPUT,
		state: process.env.GITHUB_STATE,
		step_summary: process.env.GITHUB_STEP_SUMMARY,
	};
}

function deriveRunnerContext(): Record<string, unknown> {
	return {
		os: process.env.RUNNER_OS,
		arch: process.env.RUNNER_ARCH,
		name: process.env.RUNNER_NAME,
		environment: process.env.RUNNER_ENVIRONMENT,
		temp: process.env.RUNNER_TEMP,
		tool_cache: process.env.RUNNER_TOOL_CACHE,
		debug: process.env.RUNNER_DEBUG,
	};
}

function deriveJobContext(): Record<string, unknown> {
	// `job.container` and `job.services` are only available via the runner's
	// expression substitution, never to the action process. Surface what we
	// can — the job id — and leave a placeholder status.
	return {
		status: process.env.GITHUB_ACTION_STATUS ?? 'success',
	};
}

function readContexts(): WorkflowContexts {
	return {
		// Auto-derived from env vars and the event-payload file. An explicit
		// JSON input (when present) wins, mainly for tests / dry runs.
		github: maybeParseJson('github') ?? deriveGithubContext(),
		runner: maybeParseJson('runner') ?? deriveRunnerContext(),
		job: maybeParseJson('job') ?? deriveJobContext(),
		// Workflow `env:` context: GitHub doesn't distinguish those vars from
		// system env in the action's process, so we default to all of process.env.
		env: maybeParseJson('env') ?? { ...process.env },
		// The runner never exposes these contexts to action processes — they
		// only exist as workflow-expression substitutions. Default to {}; the
		// caller passes JSON only when they actually need them.
		steps: parseOptionalContext('steps'),
		needs: parseOptionalContext('needs'),
		vars: parseOptionalContext('vars'),
		secrets: parseOptionalContext('secrets'),
		inputs: parseOptionalContext('inputs'),
		strategy: parseOptionalContext('strategy'),
		matrix: parseOptionalContext('matrix'),
	};
}

function baseCompilerOptions(): ts.CompilerOptions {
	return {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.CommonJS,
		moduleResolution: ts.ModuleResolutionKind.Node10,
		strict: true,
		esModuleInterop: true,
		skipLibCheck: true,
		forceConsistentCasingInFileNames: true,
		resolveJsonModule: true,
		allowSyntheticDefaultImports: true,
		lib: ['lib.es2022.d.ts'],
		types: ['node'],
		typeRoots: [path.join(TYPES_DIR, 'node_modules', '@types')],
		baseUrl: TYPES_DIR,
	};
}

function typeCheck(source: string): readonly ts.Diagnostic[] {
	const opts: ts.CompilerOptions = { ...baseCompilerOptions(), noEmit: true };

	const sources = new Map<string, string>([[VIRTUAL_FILE, source]]);
	const host = ts.createCompilerHost(opts);
	const originalReadFile = host.readFile.bind(host);
	const originalFileExists = host.fileExists.bind(host);
	const originalGetSourceFile = host.getSourceFile.bind(host);

	host.readFile = (fileName) => sources.get(fileName) ?? originalReadFile(fileName);
	host.fileExists = (fileName) => sources.has(fileName) || originalFileExists(fileName);
	host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
		const synthetic = sources.get(fileName);
		if (synthetic !== undefined) {
			return ts.createSourceFile(fileName, synthetic, languageVersion, true);
		}
		return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
	};

	const program = ts.createProgram({
		rootNames: [VIRTUAL_FILE],
		options: opts,
		host,
	});

	return [
		...program.getSyntacticDiagnostics(),
		...program.getSemanticDiagnostics(),
		...program.getGlobalDiagnostics(),
	];
}

function formatDiagnostic(d: ts.Diagnostic): string {
	const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
	if (d.file && d.start !== undefined) {
		const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
		const userLine = Math.max(1, line - WRAPPER_PREFIX_LINES + 1);
		return `script:${userLine}:${character + 1}: error TS${d.code}: ${message}`;
	}
	return `error TS${d.code}: ${message}`;
}

function transpile(source: string): string {
	const result = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
		},
		fileName: VIRTUAL_FILE,
		reportDiagnostics: false,
	});
	return result.outputText;
}

function makeRequire(): (name: string) => unknown {
	const builtins: Record<string, unknown> = {
		'@actions/core': core,
		'@actions/github': github,
		'@actions/exec': exec,
		'@actions/io': io,
		fs,
		path,
		os,
		child_process,
		util,
	};
	return (name: string): unknown => {
		if (name in builtins) return builtins[name];
		return require(name);
	};
}

async function execute(transpiledJs: string, ctx: WorkflowContexts): Promise<unknown> {
	const fakeRequire = makeRequire();
	const fakeModule: { exports: unknown } = { exports: {} };

	// User code is the body of an async function definition (`async function
	// __runUserScript() { ... }`). After transpilation we call it and return
	// the awaited value. The Function wrapper provides parameters for the
	// helpers; their names exactly match those declared in GLOBALS_DTS so
	// type-checking and execution agree.
	const fn = new Function(
		'core', 'exec', 'io', 'octokit', 'context',
		'github', 'env', 'runner', 'job', 'steps', 'needs',
		'vars', 'secrets', 'inputs', 'strategy', 'matrix',
		'fs', 'path', 'os', 'child_process', 'util',
		'require', 'module', 'exports', '__filename', '__dirname',
		`${transpiledJs}\nreturn __runUserScript();`,
	);

	return await fn(
		core, exec, io, github.getOctokit, github.context,
		ctx.github, ctx.env, ctx.runner, ctx.job, ctx.steps, ctx.needs,
		ctx.vars, ctx.secrets, ctx.inputs, ctx.strategy, ctx.matrix,
		fs, path, os, child_process, util,
		fakeRequire, fakeModule, fakeModule.exports, '<user-script>', process.cwd(),
	);
}

async function run(): Promise<void> {
	const userScript = core.getInput('script', { required: true });
	const ctx = readContexts();
	const source = buildSource(userScript);

	core.startGroup('Type-checking with tsc');
	const diagnostics = typeCheck(source);
	if (diagnostics.length > 0) {
		for (const d of diagnostics) {
			core.error(formatDiagnostic(d));
		}
		core.endGroup();
		core.setFailed(`TypeScript validation failed with ${diagnostics.length} error(s).`);
		return;
	}
	core.info('Type-check passed.');
	core.endGroup();

	core.startGroup('Transpiling');
	const js = transpile(source);
	core.info(`Transpiled output: ${js.length} bytes`);
	core.endGroup();

	core.startGroup('Executing script');
	const result = await execute(js, ctx);
	core.endGroup();

	if (result !== undefined) {
		core.setOutput('result', JSON.stringify(result));
	}
}

run().catch((err) => {
	core.setFailed(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
