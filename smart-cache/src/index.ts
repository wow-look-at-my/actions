import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as fs from 'fs';
import * as path from 'path';

function getFiles(dir: string): string[] {
	const files: string[] = [];
	if (!fs.existsSync(dir)) return files;

	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		return [dir];
	}

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...getFiles(fullPath));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

function snapshotPaths(paths: string[]): Map<string, number> {
	const snapshot = new Map<string, number>();
	for (const p of paths) {
		for (const file of getFiles(p)) {
			snapshot.set(file, fs.statSync(file).mtimeMs);
		}
	}
	return snapshot;
}

function getChangedFiles(before: Map<string, number>, after: Map<string, number>): string[] {
	const changed: string[] = [];

	// Check for modified or new files
	for (const [file, mtime] of after) {
		const oldMtime = before.get(file);
		if (oldMtime !== mtime) {
			changed.push(file);
		}
	}

	// Check for deleted files
	for (const file of before.keys()) {
		if (!after.has(file)) {
			changed.push(file);
		}
	}

	return changed;
}

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
	const snapshot = snapshotPaths(paths);
	core.info(`Snapshot: ${snapshot.size} files`);

	// Save state for post step
	core.saveState('paths', JSON.stringify(paths));
	core.saveState('key', key);
	core.saveState('snapshot', JSON.stringify([...snapshot]));
	core.saveState('isPost', 'true');
}

async function post(): Promise<void> {
	const pathsJson = core.getState('paths');
	const key = core.getState('key');
	const snapshotJson = core.getState('snapshot');

	if (!pathsJson || !key || !snapshotJson) {
		core.info('No cache state found, skipping save');
		return;
	}

	const paths: string[] = JSON.parse(pathsJson);
	const before = new Map<string, number>(JSON.parse(snapshotJson));

	// Check for changes
	core.info('Checking for cache changes...');
	const after = snapshotPaths(paths);
	const changed = getChangedFiles(before, after);

	if (changed.length === 0) {
		core.info('No cache changes detected, skipping save');
		return;
	}

	// Print changes (first 100)
	for (let i = 0; i < Math.min(changed.length, 100); i++) {
		core.info(changed[i]);
	}
	if (changed.length > 100) {
		core.info(`... and ${changed.length - 100} more`);
	}
	core.info(`Total: ${changed.length} files changed`);

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
				// Cache reservation conflicts are expected when multiple jobs share a cache key
				if (error.message.includes('Unable to reserve cache')) {
					core.info('Cache already saved by another job');
				} else {
					core.warning(`Cache save failed: ${error.message}`);
				}
			} else {
				core.setFailed(error.message);
			}
		}
	}
}

run();
