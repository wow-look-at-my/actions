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

function parseContextInput(name: string): unknown {
	const raw = core.getInput(name);
	if (!raw || !raw.trim()) return {};
	try {
		return JSON.parse(raw);
	} catch (e) {
		throw new Error(`Input '${name}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function readContexts(): WorkflowContexts {
	return {
		github: parseContextInput('github'),
		env: parseContextInput('env'),
		runner: parseContextInput('runner'),
		job: parseContextInput('job'),
		steps: parseContextInput('steps'),
		needs: parseContextInput('needs'),
		vars: parseContextInput('vars'),
		secrets: parseContextInput('secrets'),
		inputs: parseContextInput('inputs'),
		strategy: parseContextInput('strategy'),
		matrix: parseContextInput('matrix'),
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
