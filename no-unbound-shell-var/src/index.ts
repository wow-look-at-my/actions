import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {formatFinding, scanFile} from './scan';

// A step under `set -u` dies on the first name nothing bound. see README.md

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function splitList(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map(entry => entry.trim())
		.filter(entry => entry !== '');
}

// Glob to regex: `**` crosses directory separators, `*` and `?` do not.
function globToRegExp(glob: string): RegExp {
	let pattern = '';
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*') {
			if (glob[index + 1] === '*') {
				index++;
				if (glob[index + 1] === '/') {
					index++;
					pattern += '(?:.*/)?';
					continue;
				}
				pattern += '.*';
				continue;
			}
			pattern += '[^/]*';
			continue;
		}
		if (char === '?') {
			pattern += '[^/]';
			continue;
		}
		pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${pattern}$`);
}

async function walk(root: string, relative: string, found: string[]): Promise<void> {
	const entries = await fsp.readdir(path.join(root, relative), {withFileTypes: true});
	for (const entry of entries) {
		const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) {
				continue;
			}
			await walk(root, child, found);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(child);
		const isAction = /(^|\/)action\.ya?ml$/.test(child);
		if (isWorkflow || isAction) {
			found.push(child);
		}
	}
}

async function readIfPresent(file: string): Promise<string | undefined> {
	try {
		return await fsp.readFile(file, 'utf8');
	} catch (error) {
		if ((error as {code?: string}).code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

async function run(): Promise<void> {
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const excludes = splitList(core.getInput('exclude')).map(globToRegExp);
	const isExcluded = (file: string): boolean => excludes.some(pattern => pattern.test(file));

	const explicit = splitList(core.getInput('paths'));
	let roots: string[] = [];
	if (explicit.length > 0) {
		roots = explicit.map(entry => path.posix.normalize(entry.replace(/^\.\//, '')));
	} else {
		await walk(workspace, '', roots);
		roots.sort();
	}

	const messages: string[] = [];
	const missing: string[] = [];
	const scanned: string[] = [];

	for (const file of roots) {
		if (isExcluded(file)) {
			continue;
		}
		const content = await readIfPresent(path.join(workspace, file));
		if (content === undefined) {
			missing.push(`${file}: no such file in the workspace — the paths input names a file that is not here`);
			continue;
		}
		scanned.push(file);
		const result = scanFile(content);
		for (const line of result.skipped) {
			core.info(`${file}:${line}: the step turns nounset back off, so it went unchecked`);
		}
		for (const finding of result.findings) {
			messages.push(formatFinding(file, finding));
		}
	}

	if (messages.length === 0 && missing.length === 0) {
		if (scanned.length === 0) {
			// The check enforced nothing. A repo that runs this action has at
			// least one workflow file, so an empty scan means the workspace is
			// not the repo -- usually a missing checkout.
			core.warning(`nothing to scan under ${workspace} — no workflow file and no action.yml, so this run enforced nothing. Check the repo out first.`);
			return;
		}
		core.info(`OK — every \`set -u\` step binds what it reads, across ${scanned.length} file(s)`);
		return;
	}
	for (const message of [...messages, ...missing]) {
		core.error(message);
	}
	if (messages.length > 0) {
		core.setFailed(`${messages.length} unbound variable read(s) under \`set -u\`, across ${scanned.length} scanned file(s). Each one kills its step on the first line that reads it.`);
		return;
	}
	core.setFailed(`${missing.length} named file(s) are not in the workspace, so they went unscanned`);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
