import * as core from '@actions/core';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {formatFinding, scanWorkflowYaml} from './scan';

async function run(): Promise<void> {
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const dir = path.join(workspace, '.github', 'workflows');

	let entries: string[];
	try {
		entries = await fsp.readdir(dir);
	} catch {
		core.warning(`no ${dir}, so this run enforced nothing. Check the repo out first.`);
		return;
	}

	const names = entries.filter(name => /\.ya?ml$/.test(name)).sort();
	if (names.length === 0) {
		core.warning(`no workflow file under ${dir}, so this run enforced nothing.`);
		return;
	}

	let found = 0;
	for (const name of names) {
		const file = `.github/workflows/${name}`;
		const content = await fsp.readFile(path.join(dir, name), 'utf8');
		for (const finding of scanWorkflowYaml(content)) {
			found++;
			core.error(formatFinding(file), {file, startLine: finding.line, startColumn: finding.column});
		}
	}

	if (found > 0) {
		core.setFailed(`${found} of ${names.length} workflow(s) still match tag pushes`);
		return;
	}
	core.info(`OK - every push trigger names a ref filter in ${names.length} file(s)`);
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
