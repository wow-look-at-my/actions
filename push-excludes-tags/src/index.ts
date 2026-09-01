import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {formatViolation, scanWorkflow} from './scan';

// Every workflow file of the calling repo, checked for a push trigger that
// still matches tag pushes. see README.md

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

async function workflowFiles(dir: string): Promise<string[] | undefined> {
	try {
		const entries = await fsp.readdir(dir);
		return entries.filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
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

	const dir = path.join(workspace, '.github', 'workflows');
	const names = await workflowFiles(dir);
	if (names === undefined) {
		core.warning(`no .github/workflows directory under ${workspace}, so this run enforced nothing. Check the repo out first.`);
		return;
	}

	const scanned: string[] = [];
	const messages: string[] = [];
	for (const name of names) {
		const file = `.github/workflows/${name}`;
		if (isExcluded(file)) {
			continue;
		}
		scanned.push(file);
		for (const violation of scanWorkflow(file, await fsp.readFile(path.join(dir, name), 'utf8'))) {
			messages.push(formatViolation(violation));
		}
	}

	if (messages.length === 0) {
		if (scanned.length === 0) {
			core.warning(`no workflow file under ${dir}, so this run enforced nothing.`);
			return;
		}
		core.info(`OK - every push trigger names a ref filter in ${scanned.length} file(s): ${scanned.join(', ')}`);
		return;
	}
	for (const message of messages) {
		core.error(message);
	}
	core.setFailed(`${messages.length} push trigger(s) still match tag pushes, across ${scanned.length} scanned file(s)`);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
