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

type ShellArg = string | number | boolean | null | undefined | string[];

class ExecBuilder implements PromiseLike<number> {
	private cmd: string;
	private args: string[];
	private opts: exec.ExecOptions;

	constructor(cmd: string, args: string[], opts: exec.ExecOptions = {}) {
		this.cmd = cmd;
		this.args = args;
		this.opts = opts;
	}

	input(data: Buffer | string): ExecBuilder {
		return new ExecBuilder(this.cmd, this.args, {
			...this.opts,
			input: Buffer.isBuffer(data) ? data : Buffer.from(data),
		});
	}

	cwd(dir: string): ExecBuilder {
		return new ExecBuilder(this.cmd, this.args, { ...this.opts, cwd: dir });
	}

	silent(): ExecBuilder {
		return new ExecBuilder(this.cmd, this.args, { ...this.opts, silent: true });
	}

	then<T = number, R = never>(
		onfulfilled?: ((v: number) => T | PromiseLike<T>) | null,
		onrejected?: ((e: any) => R | PromiseLike<R>) | null,
	): Promise<T | R> {
		return exec.exec(this.cmd, this.args, this.opts).then(onfulfilled, onrejected);
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

const GLOBALS_DTS = fs.readFileSync(path.join(DIST_DIR, 'globals.d.ts'), 'utf-8');

const SOURCE_PREFIX = `${GLOBALS_DTS}\nexport {};\n`;
const PREFIX_LINES = SOURCE_PREFIX.split('\n').length - 1;

function buildSource(userScript: string): string {
	return SOURCE_PREFIX + userScript;
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

const OWN_INPUTS = new Set([
	'SCRIPT', 'FILE',
	'VARS', 'SECRETS', 'STEPS', 'NEEDS', 'STRATEGY', 'MATRIX',
]);

function deriveInputs(): Record<string, string> {
	const inputs: Record<string, string> = {};

	// _INPUTS env var: JSON blob from composite action's toJSON(inputs).
	// Parse it, use it as the inputs context, and export as INPUT_* to
	// GITHUB_ENV so subsequent steps auto-detect them.
	const raw = process.env._INPUTS;
	if (raw && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			for (const [key, val] of Object.entries(parsed)) {
				const k = key.toLowerCase();
				inputs[k] = String(val);
				core.exportVariable(`INPUT_${key.toUpperCase()}`, String(val));
			}
			return inputs;
		} catch {
			// fall through to INPUT_* scan
		}
	}

	// Fallback: scan INPUT_* env vars (e.g. from a prior propagation step).
	for (const [key, val] of Object.entries(process.env)) {
		if (!key.startsWith('INPUT_') || val === undefined) continue;
		const name = key.slice(6);
		if (OWN_INPUTS.has(name)) continue;
		inputs[name.toLowerCase()] = val;
	}
	return inputs;
}

function readContexts(): WorkflowContexts {
	return {
		// Auto-derived from env vars.
		github: deriveGithubContext(),
		runner: deriveRunnerContext(),
		job: deriveJobContext(),
		env: { ...process.env },
		inputs: deriveInputs(),
		// The runner never exposes these contexts to action processes — they
		// only exist as workflow-expression substitutions. Default to {}; the
		// caller passes JSON only when they actually need them.
		steps: parseOptionalContext('steps'),
		needs: parseOptionalContext('needs'),
		vars: parseOptionalContext('vars'),
		secrets: parseOptionalContext('secrets'),
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

function formatDiagnostic(d: ts.Diagnostic, label: string): string {
	const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
	if (d.file && d.start !== undefined) {
		const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
		const userLine = Math.max(1, line - PREFIX_LINES + 1);
		return `${label}:${userLine}:${character + 1}: error TS${d.code}: ${message}`;
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

async function execute(transpiledJs: string, ctx: WorkflowContexts, baseDir: string): Promise<unknown> {
	Object.assign(globalThis, {
		$, core, exec, io,
		octokit: github.getOctokit,
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
		await fn(scriptRequire, mod.exports, mod, scriptFilename, baseDir);
		if (typeof mod.exports === 'object' && mod.exports !== null && Object.keys(mod.exports).length === 0) {
			return undefined;
		}
		return mod.exports;
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
	const source = buildSource(userScript);

	core.startGroup('Type-checking with tsc');
	const diagnostics = typeCheck(source);
	if (diagnostics.length > 0) {
		for (const d of diagnostics) {
			core.error(formatDiagnostic(d, label));
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
	const result = await execute(js, ctx, dir);
	core.endGroup();

	if (result !== undefined) {
		core.setOutput('result', JSON.stringify(result));
	}
}

run().catch((err) => {
	core.setFailed(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
