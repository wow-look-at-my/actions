import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {isLevel, Level, resolve} from './permissions';

// Whether the running job holds a permission, read from the job block and the
// workflow block of the workflow file. see README.md

// GITHUB_WORKFLOW_REF is owner/repo/.github/workflows/ci.yml@refs/heads/master.
function workflowPath(ref: string): string {
	const at = ref.lastIndexOf('@');
	const withoutRef = at === -1 ? ref : ref.slice(0, at);
	const parts = withoutRef.split('/');
	if (parts.length < 3) {
		throw new Error(`GITHUB_WORKFLOW_REF is '${ref}', which names no workflow file`);
	}
	return parts.slice(2).join('/');
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is unset, so the running job cannot be identified. This action runs in GitHub Actions only.`);
	}
	return value;
}

async function run(): Promise<void> {
	const permission = core.getInput('permission', {required: true}).trim();
	const level = core.getInput('level').trim() || 'write';
	if (!isLevel(level)) {
		throw new Error(`level is '${level}', not read, write or none`);
	}

	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const file = core.getInput('workflow').trim() || workflowPath(required('GITHUB_WORKFLOW_REF'));
	const job = core.getInput('job').trim() || required('GITHUB_JOB');

	const content = await fsp.readFile(path.join(workspace, file), 'utf8');
	const found = resolve(content, job, permission, level as Level);

	core.setOutput('granted', String(found.granted));
	core.setOutput('level', found.level);
	core.setOutput('source', found.source);

	const where = `${file} job '${job}'`;
	if (found.granted) {
		core.info(`${permission}: ${found.level} is granted to ${where} by its ${found.source} permissions block`);
		return;
	}

	const why = found.source === 'default'
		? `${where} declares no permissions block, so ${permission} falls to the repository default. Declare the block to grant it.`
		: `${permission}: ${level} is NOT granted to ${where}. Its ${found.source} permissions block gives ${found.level}.`;

	if (core.getBooleanInput('assert')) {
		core.setFailed(why);
		return;
	}
	if (found.source === 'default') {
		core.warning(why);
		return;
	}
	core.info(why);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
