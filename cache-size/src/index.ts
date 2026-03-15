import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

interface SizeEntry {
	path: string;
	bytes: number;
	human: string;
}

function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let i = -1;
	let size = bytes;
	do {
		size /= 1024;
		i++;
	} while (size >= 1024 && i < units.length - 1);
	return `${size.toFixed(1)} ${units[i]}`;
}

function dirSize(dir: string): number {
	let total = 0;
	if (!fs.existsSync(dir)) return 0;
	const stat = fs.statSync(dir);
	if (stat.isFile()) return stat.size;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			total += dirSize(full);
		} else if (entry.isFile()) {
			try {
				total += fs.statSync(full).size;
			} catch {
				// skip unreadable files
			}
		}
	}
	return total;
}

function collectAtDepth(dir: string, currentDepth: number, maxDepth: number): SizeEntry[] {
	if (!fs.existsSync(dir)) return [];

	const stat = fs.statSync(dir);
	if (!stat.isDirectory()) {
		return [{ path: dir, bytes: stat.size, human: humanSize(stat.size) }];
	}

	if (currentDepth >= maxDepth) {
		const bytes = dirSize(dir);
		return [{ path: dir, bytes, human: humanSize(bytes) }];
	}

	const results: SizeEntry[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectAtDepth(full, currentDepth + 1, maxDepth));
		} else if (entry.isFile()) {
			try {
				const size = fs.statSync(full).size;
				results.push({ path: full, bytes: size, human: humanSize(size) });
			} catch {
				// skip
			}
		}
	}

	return results;
}

function run(): void {
	const rawPaths = core.getInput('paths');
	const depth = parseInt(core.getInput('depth') || '1', 10);
	const paths = rawPaths.split(/[\n\s]+/).filter(Boolean);

	if (paths.length === 0) {
		core.setFailed('No paths provided');
		return;
	}

	const allEntries: SizeEntry[] = [];
	let grandTotal = 0;

	// Find longest path for alignment
	const allRows: { path: string; bytes: number; human: string; isTotal: boolean }[] = [];

	for (const p of paths) {
		const resolved = path.resolve(p);
		if (!fs.existsSync(resolved)) {
			core.warning(`Path does not exist: ${resolved}`);
			continue;
		}

		const totalBytes = dirSize(resolved);
		grandTotal += totalBytes;

		allRows.push({ path: resolved, bytes: totalBytes, human: humanSize(totalBytes), isTotal: true });
		allEntries.push({ path: resolved, bytes: totalBytes, human: humanSize(totalBytes) });

		if (depth > 0) {
			const children = collectAtDepth(resolved, 0, depth);
			// Sort children by size descending
			children.sort((a, b) => b.bytes - a.bytes);
			for (const child of children) {
				const rel = path.relative(resolved, child.path);
				allRows.push({ path: `  ${rel}`, bytes: child.bytes, human: child.human, isTotal: false });
			}
		}
	}

	// Print table
	if (allRows.length === 0) {
		core.info('No paths found to measure.');
		return;
	}

	const maxPath = Math.max(...allRows.map(r => r.path.length));
	const maxSize = Math.max(...allRows.map(r => r.human.length));

	core.info('');
	core.info('Cache Size Breakdown');
	core.info('─'.repeat(maxPath + maxSize + 5));

	for (const row of allRows) {
		const line = `${row.path.padEnd(maxPath)}  ${row.human.padStart(maxSize)}`;
		if (row.isTotal) {
			core.info(line);
		} else {
			core.info(line);
		}
	}

	core.info('─'.repeat(maxPath + maxSize + 5));
	core.info(`${'Total'.padEnd(maxPath)}  ${humanSize(grandTotal).padStart(maxSize)}`);
	core.info('');

	// Set outputs
	core.setOutput('total-bytes', grandTotal.toString());
	core.setOutput('breakdown', JSON.stringify(allEntries));
}

try {
	run();
} catch (error) {
	if (error instanceof Error) {
		core.setFailed(error.message);
	}
}
