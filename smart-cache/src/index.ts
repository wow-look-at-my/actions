import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as exec from '@actions/exec';

async function main(): Promise<void> {
	const paths = core.getInput('path').split(/\s+/).filter(Boolean);
	const key = core.getInput('key');

	// Restore cache
	const cacheKey = await cache.restoreCache(paths, key);
	if (cacheKey) {
		core.info(`Cache restored from key: ${cacheKey}`);
		core.setOutput('cache-hit', 'true');
	} else {
		core.info('Cache not found');
		core.setOutput('cache-hit', 'false');
	}

	// Take snapshot
	core.info('Taking cache snapshot...');
	await exec.exec('marketplace-build', ['cache-snapshot', ...paths]);

	// Save state for post step
	core.saveState('paths', JSON.stringify(paths));
	core.saveState('key', key);
	core.saveState('isPost', 'true');
}

async function post(): Promise<void> {
	const pathsJson = core.getState('paths');
	const key = core.getState('key');

	if (!pathsJson || !key) {
		core.info('No cache state found, skipping save');
		return;
	}

	const paths: string[] = JSON.parse(pathsJson);

	// Check for changes
	core.info('Checking for cache changes...');
	let lineCount = 0;
	const outputLines: string[] = [];

	await exec.exec('marketplace-build', ['cache-changed', ...paths], {
		listeners: {
			stdout: (data: Buffer) => {
				const lines = data.toString().split('\n').filter(Boolean);
				for (const line of lines) {
					lineCount++;
					if (lineCount <= 100) {
						outputLines.push(line);
					}
				}
			}
		}
	});

	if (lineCount === 0) {
		core.info('No cache changes detected, skipping save');
		return;
	}

	// Print changes (first 100)
	for (const line of outputLines) {
		core.info(line);
	}
	core.info(`Total: ${lineCount} files changed`);

	// Save cache
	core.info('Saving cache...');
	await cache.saveCache(paths, key);
	core.info('Cache saved');
}

async function run(): Promise<void> {
	try {
		const isPost = core.getState('isPost') === 'true';
		if (isPost) {
			await post();
		} else {
			await main();
		}
	} catch (error) {
		if (error instanceof Error) {
			if (core.getState('isPost') === 'true') {
				core.warning(`Cache save failed: ${error.message}`);
			} else {
				core.setFailed(error.message);
			}
		}
	}
}

run();
