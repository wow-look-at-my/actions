import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface ActionInputs {
	path: string;
	exclude: string[];
	failOnViolation: boolean;
}

interface CheckResult {
	filesChecked: number;
	filesWithScripts: number;
	violations: string[];
}

function parseInputs(): ActionInputs {
	const parseList = (input: string): string[] => {
		return input
			.split(/[\n,]/)
			.map(s => s.trim())
			.filter(s => s.length > 0);
	};

	return {
		path: core.getInput('path') || '.',
		exclude: parseList(core.getInput('exclude')),
		failOnViolation: core.getBooleanInput('fail-on-violation'),
	};
}

async function findPackageJsonFiles(inputs: ActionInputs): Promise<string[]> {
	const matches = await glob('**/package.json', {
		cwd: inputs.path,
		nodir: true,
		absolute: true,
		ignore: inputs.exclude,
	});
	return matches.sort();
}

function checkPackageJson(filePath: string): boolean {
	const content = fs.readFileSync(filePath, 'utf-8');
	const pkg = JSON.parse(content);
	return 'scripts' in pkg;
}

async function runCheck(inputs: ActionInputs): Promise<CheckResult> {
	const files = await findPackageJsonFiles(inputs);
	const violations: string[] = [];

	for (const file of files) {
		try {
			if (checkPackageJson(file)) {
				violations.push(file);
			}
		} catch (error) {
			core.warning(`Failed to parse ${file}: ${error}`);
		}
	}

	return {
		filesChecked: files.length,
		filesWithScripts: violations.length,
		violations,
	};
}

function reportToConsole(result: CheckResult, workdir: string): void {
	console.log('');
	console.log('No Scripts Check');
	console.log('================');
	console.log('');

	if (result.filesWithScripts === 0) {
		console.log(`\u2705 All ${result.filesChecked} package.json files are scripts-free`);
		return;
	}

	console.log(`\u274c Found ${result.filesWithScripts} package.json files with scripts sections:\n`);

	for (const file of result.violations) {
		const relPath = path.relative(workdir, file);
		console.log(`  \u2022 ${relPath}`);

		core.error('package.json contains scripts section - use a justfile instead', {
			file: relPath,
			startLine: 1,
			title: 'Scripts Section Found',
		});
	}

	console.log('\n\ud83d\udca1 Tip: Move scripts to a justfile and remove the scripts section from package.json');
}

async function run(): Promise<void> {
	try {
		const inputs = parseInputs();
		const workdir = path.resolve(inputs.path);

		core.info(`Checking for scripts in package.json files in: ${workdir}`);

		const result = await runCheck(inputs);

		reportToConsole(result, workdir);

		core.setOutput('files-checked', result.filesChecked.toString());
		core.setOutput('files-with-scripts', result.filesWithScripts.toString());
		core.setOutput('violation-list', JSON.stringify(result.violations));

		if (inputs.failOnViolation && result.filesWithScripts > 0) {
			core.setFailed(
				`Found ${result.filesWithScripts} package.json files with scripts sections. ` +
				`Use justfiles instead.`
			);
		}
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		} else {
			core.setFailed('An unexpected error occurred');
		}
	}
}

run();
