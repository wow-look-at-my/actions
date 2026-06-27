import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import * as util from 'util';
import { createRequire } from 'module';
import * as ts from 'typescript';
import { MAIN_FN, transformScript } from './transform';

type ShellArg = string | number | boolean | null | undefined | string[];

/**
 * Result of awaiting a `$` command: the captured streams plus the exit code.
 * `toString()` returns stdout (trailing newline trimmed) so a command's output
 * can be string-coerced inline, while the `stdout` property is the raw output.
 */
class ProcessOutput {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;

	constructor(out: exec.ExecOutput) {
		this.stdout = out.stdout;
		this.stderr = out.stderr;
		this.exitCode = out.exitCode;
	}

	/** stdout with a single trailing newline (`\n` or `\r\n`) removed. */
	toString(): string {
		return this.stdout.replace(/\r?\n$/, '');
	}
}

/**
 * Thrown when a `$` command exits non-zero (unless `.nothrow()` was chained).
 * Carries the captured `stdout`/`stderr`/`exitCode` so a `catch` can inspect
 * the failure without re-running the command.
 */
class ProcessError extends Error {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;

	constructor(command: string, output: ProcessOutput) {
		const detail = output.stderr.trim();
		super(`\`$\` command failed with exit code ${output.exitCode}: ${command}${detail ? `\n${detail}` : ''}`);
		this.name = 'ProcessError';
		this.stdout = output.stdout;
		this.stderr = output.stderr;
		this.exitCode = output.exitCode;
	}
}

class ExecBuilder implements PromiseLike<ProcessOutput> {
	private cmd: string;
	private args: string[];
	private opts: exec.ExecOptions;
	private throwOnNonZero: boolean;

	constructor(cmd: string, args: string[], opts: exec.ExecOptions = {}, throwOnNonZero = true) {
		this.cmd = cmd;
		this.args = args;
		this.opts = opts;
		this.throwOnNonZero = throwOnNonZero;
	}

	private with(patch: Partial<exec.ExecOptions>, throwOnNonZero = this.throwOnNonZero): ExecBuilder {
		return new ExecBuilder(this.cmd, this.args, { ...this.opts, ...patch }, throwOnNonZero);
	}

	/** Pipe data to the command's stdin. */
	input(data: Buffer | string): ExecBuilder {
		return this.with({ input: Buffer.isBuffer(data) ? data : Buffer.from(data) });
	}

	/** Set the working directory. */
	cwd(dir: string): ExecBuilder {
		return this.with({ cwd: dir });
	}

	/** Suppress streaming stdout/stderr to the live log (still captured). */
	silent(): ExecBuilder {
		return this.with({ silent: true });
	}

	/**
	 * Merge/override environment variables for this command. @actions/exec
	 * *replaces* the environment when `env` is set, so seed from the current
	 * process env (or a prior `.env()`) and layer the overrides on top.
	 */
	env(vars: Record<string, string>): ExecBuilder {
		const base = this.opts.env ?? (process.env as Record<string, string>);
		return this.with({ env: { ...base, ...vars } });
	}

	/** Resolve even on a non-zero exit; read `exitCode` instead of catching. */
	nothrow(): ExecBuilder {
		return this.with({}, false);
	}

	private async run(): Promise<ProcessOutput> {
		// Always capture and never let getExecOutput throw on a non-zero exit
		// (ignoreReturnCode), so stdout/stderr survive a failure; the throw
		// decision is made here so the error can carry the captured output.
		const raw = await exec.getExecOutput(this.cmd, this.args, { ...this.opts, ignoreReturnCode: true });
		const output = new ProcessOutput(raw);
		if (this.throwOnNonZero && raw.exitCode !== 0) {
			throw new ProcessError([this.cmd, ...this.args].join(' '), output);
		}
		return output;
	}

	then<T = ProcessOutput, R = never>(
		onfulfilled?: ((v: ProcessOutput) => T | PromiseLike<T>) | null,
		onrejected?: ((e: any) => R | PromiseLike<R>) | null,
	): Promise<T | R> {
		return this.run().then(onfulfilled, onrejected);
	}
}

function $(strings: TemplateStringsArray, ...values: ShellArg[]): ExecBuilder {
	const args: string[] = [];
	for (let i = 0; i < strings.length; i++) {
		for (const token of strings[i].split(/\s+/)) {
			if (token) args.push(token);
		}
		if (i < values.length) {
			const val = values[i];
			if (val === null || val === undefined || val === false || val === '') continue;
			if (val === true) continue;
			if (Array.isArray(val)) {
				for (const v of val) { if (v) args.push(v); }
			} else {
				args.push(String(val));
			}
		}
	}
	if (args.length === 0) throw new Error('$`...` template produced no arguments');
	const [cmd, ...cmdArgs] = args;
	return new ExecBuilder(cmd, cmdArgs);
}

// dist/ layout produced by `just build`:
//   dist/index.js                  (bundled action)
//   dist/lib.es*.d.ts              (TypeScript standard libs)
//   dist/types/node_modules/...    (mirrored types for module resolution)
const DIST_DIR = __dirname;
const TYPES_DIR = path.join(DIST_DIR, 'types');
// Virtual file for type-checking. Located under TYPES_DIR so node module
// resolution finds dist/types/node_modules/* by walking up.
const VIRTUAL_FILE = path.join(TYPES_DIR, '__user-script.ts');
// The ambient declarations for the injected helpers are served to tsc as their
// own in-memory global script file (a .d.ts with no top-level import/export),
// not prepended into the user's module: that keeps user line numbers intact and
// lets a user-level `import * as path from 'node:path'` legally shadow the
// injected `path` instead of colliding with a same-file declaration.
const GLOBALS_VIRTUAL_FILE = path.join(TYPES_DIR, '__globals.d.ts');

const GLOBALS_DTS = fs.readFileSync(path.join(DIST_DIR, 'globals.d.ts'), 'utf-8');

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
		module: ts.ModuleKind.ES2022,
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

	const sources = new Map<string, string>([
		[VIRTUAL_FILE, source],
		[GLOBALS_VIRTUAL_FILE, GLOBALS_DTS],
	]);
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
		rootNames: [VIRTUAL_FILE, GLOBALS_VIRTUAL_FILE],
		options: opts,
		host,
	});

	// Syntactic/semantic diagnostics are scoped to the user's file: the globals
	// file is the action's own (and skipLibCheck'd), and collecting program-wide
	// would surface its diagnostics under a misleading user-facing label.
	const userFile = program.getSourceFile(VIRTUAL_FILE);
	return [
		...program.getSyntacticDiagnostics(userFile),
		...program.getSemanticDiagnostics(userFile),
		...program.getGlobalDiagnostics(),
	];
}

// Maps an emitted (transformed) 0-based line back to a 1-based user-script
// line. Synthetic wrapper lines have no source line; fall back to the nearest
// preceding user line so errors like "'}' expected" still point somewhere sane.
function toUserLine(lineMap: number[], outLine: number): number {
	for (let i = Math.min(outLine, lineMap.length - 1); i >= 0; i--) {
		if (lineMap[i] >= 0) return lineMap[i] + 1;
	}
	return 1;
}

function formatDiagnostic(d: ts.Diagnostic, label: string, lineMap: number[]): string {
	const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
	if (d.file && d.start !== undefined) {
		const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
		if (d.file.fileName !== VIRTUAL_FILE) {
			// Diagnostics are scoped to the user file; anything else (e.g. from
			// getGlobalDiagnostics) is labeled by its own name, unmapped.
			return `${path.basename(d.file.fileName)}:${line + 1}:${character + 1}: error TS${d.code}: ${message}`;
		}
		return `${label}:${toUserLine(lineMap, line)}:${character + 1}: error TS${d.code}: ${message}`;
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

async function execute(transpiledJs: string, ctx: WorkflowContexts, baseDir: string, githubToken: string): Promise<unknown> {
	// The pre-authenticated `octokit` instance is built lazily from the
	// `github-token` action input (default ${{ github.token }}), mirroring how
	// actions/github-script obtains the automatic token. The runner does NOT put
	// GITHUB_TOKEN in the action process env, so reading process.env.GITHUB_TOKEN
	// would leave octokit unauthenticated (getOctokit('') throws on first use).
	let _preAuth: ReturnType<typeof github.getOctokit> | null = null;
	const octokitProxy = new Proxy(
		function deprecatedOctokit(token: string, options?: Record<string, unknown>) {
			core.warning('octokit(token) is deprecated; use the pre-authenticated octokit instance directly, or getOctokit(token) for a custom token');
			return github.getOctokit(token, options as any);
		},
		{
			get(_target, prop) {
				if (!_preAuth) _preAuth = github.getOctokit(githubToken);
				return (_preAuth as any)[prop];
			},
		}
	);
	Object.assign(globalThis, {
		$, core, exec, io,
		octokit: octokitProxy,
		getOctokit: github.getOctokit,
		context: github.context,
		github: ctx.github, env: ctx.env, runner: ctx.runner,
		job: ctx.job, steps: ctx.steps, needs: ctx.needs,
		vars: ctx.vars, secrets: ctx.secrets, inputs: ctx.inputs,
		strategy: ctx.strategy, matrix: ctx.matrix,
		fs, path, os, child_process, util,
	});

	const actionModules: Record<string, unknown> = {
		'@actions/core': core,
		'@actions/github': github,
		'@actions/exec': exec,
		'@actions/io': io,
	};

	const NodeModule = require('module');
	const origResolve = NodeModule._resolveFilename;
	const workspaceDir = process.env.GITHUB_WORKSPACE;

	NodeModule._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
		if (request in actionModules) return request;
		try {
			return origResolve.call(this, request, parent, isMain, options);
		} catch (e) {
			if (workspaceDir) {
				return createRequire(path.join(workspaceDir, 'noop.js')).resolve(request);
			}
			throw e;
		}
	};

	for (const [name, mod] of Object.entries(actionModules)) {
		(require.cache as any)[name] = {
			id: name, filename: name, loaded: true, exports: mod,
			parent: null, children: [], paths: [],
		};
	}

	const scriptFilename = path.join(baseDir, `.user-script-${process.pid}-${Date.now()}.js`);
	const scriptRequire = createRequire(scriptFilename);

	try {
		const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
		const fn = new AsyncFunction('require', 'exports', 'module', '__filename', '__dirname', transpiledJs);
		const mod = { exports: {} as Record<string, unknown> };
		// Running the transpiled module executes the hoisted module-scope
		// statements (imports become require() calls, export initializers run)
		// and defines __main on exports. The rest of the user's code lives in
		// __main's body — invoke it and use its resolved value as the result
		// (so `return <value>` works).
		await fn(scriptRequire, mod.exports, mod, scriptFilename, baseDir);
		const main = mod.exports[MAIN_FN];
		if (typeof main !== 'function') {
			// buildSource always wraps the script in __main; only reachable if the
			// user reassigned module.exports. Treat as "no result".
			return undefined;
		}
		return await (main as () => Promise<unknown>)();
	} finally {
		NodeModule._resolveFilename = origResolve;
		for (const name of Object.keys(actionModules)) delete (require.cache as any)[name];
	}
}

function readUserScript(): { script: string; label: string; dir: string } {
	const inline = core.getInput('script');
	const file = core.getInput('file');

	if (inline && file) {
		throw new Error("Inputs 'script' and 'file' are mutually exclusive — provide one or the other.");
	}
	if (!inline && !file) {
		throw new Error("Either 'script' or 'file' must be provided.");
	}

	if (file) {
		const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
		const resolved = path.resolve(workspace, file);
		if (!fs.existsSync(resolved)) {
			throw new Error(`File not found: ${resolved}`);
		}
		return { script: fs.readFileSync(resolved, 'utf-8'), label: file, dir: path.dirname(resolved) };
	}

	return { script: inline, label: 'script', dir: process.env.GITHUB_WORKSPACE ?? process.cwd() };
}

async function run(): Promise<void> {
	const { script: userScript, label, dir } = readUserScript();
	const ctx = readContexts();
	// Token for the injected `octokit` (and the default getOctokit() token).
	// Defaults to ${{ github.token }} via the action input, so the common case is
	// authenticated with no caller plumbing.
	const githubToken = core.getInput('github-token');
	const { text: source, lineMap } = transformScript(userScript);

	core.startGroup('Type-checking with tsc');
	const diagnostics = typeCheck(source);
	if (diagnostics.length > 0) {
		for (const d of diagnostics) {
			core.error(formatDiagnostic(d, label, lineMap));
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
	const result = await execute(js, ctx, dir, githubToken);
	core.endGroup();

	if (result !== undefined) {
		core.setOutput('result', JSON.stringify(result));
	}
}

run().catch((err) => {
	core.setFailed(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
