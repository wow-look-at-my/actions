import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

// workaround for bad language
const _resolve = path.resolve;
const home = process.env.HOME || process.env.USERPROFILE || '';
const expandTilde = (p: string): string => home && p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
const nodePath = require('path');
nodePath.resolve = (...args: string[]): string => _resolve(...args.map(expandTilde));

interface SizeEntry {
	path: string;
	bytes: number;
	human: string;
}

const MIN_DISPLAY_FRAC = 0.01; // show entries that are ≥1% of the cache dir total

function humanSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
	return `${mb.toFixed(1)} MiB`;
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

// Detect Go build cache by checking for its README marker file.
function isGoBuildCache(dir: string): boolean {
	try {
		const readme = fs.readFileSync(path.join(dir, 'README'), 'utf-8');
		return readme.includes('build artifacts');
	} catch {
		return false;
	}
}

// Extract a Go module path from the first bytes of a build cache data file.
// Go archives start with "!<arch>\n" and contain package paths as strings
// in the export data. We scan for domain-based import paths.
const importPathRe = /(?<![a-zA-Z0-9])(?:github\.com|gitlab\.com|golang\.org|modernc\.org|gopkg\.in|gotest\.tools|code\.gitea\.io|dario\.cat)\/[A-Za-z0-9_.\/@-]+/;

function extractModulePath(filePath: string): string | null {
	let fd: number;
	try {
		fd = fs.openSync(filePath, 'r');
	} catch {
		return null;
	}
	try {
		const buf = Buffer.alloc(8192);
		const n = fs.readSync(fd, buf, 0, 8192, 0);
		// Convert to string, replacing non-printable chars so regex works on the printable spans
		const str = buf.toString('latin1', 0, n);
		const m = str.match(importPathRe);
		if (!m) return null;

		// Normalize to module level: github.com/org/repo, golang.org/x/pkg, modernc.org/pkg, etc.
		const raw = m[0].replace(/@[^/]*/g, ''); // strip Go module @version suffixes
		const parts = raw.split('/');
		if (parts[0] === 'github.com' || parts[0] === 'gitlab.com') {
			return parts.slice(0, 3).join('/');
		}
		if (parts[0] === 'golang.org' && parts[1] === 'x') {
			return parts.slice(0, 3).join('/');
		}
		if (parts[0] === 'gopkg.in') {
			return parts.slice(0, 2).join('/');
		}
		return parts.slice(0, 2).join('/');
	} finally {
		fs.closeSync(fd);
	}
}

interface PkgBreakdown {
	pkg: string;
	bytes: number;
}

// Scan a Go build cache and attribute data files to modules by reading
// the package path embedded in each compiled archive.
function analyzeGoBuildCache(dir: string): PkgBreakdown[] {
	const pkgSizes = new Map<string, number>();
	const hexPattern = /^[0-9a-f]{2}$/;

	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch {
		return [];
	}

	for (const hexDir of entries) {
		if (!hexPattern.test(hexDir)) continue;
		const hexPath = path.join(dir, hexDir);

		let files: string[];
		try {
			files = fs.readdirSync(hexPath);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith('-d')) continue; // only data files, skip action files (-a)
			const filePath = path.join(hexPath, file);

			let size: number;
			try {
				size = fs.statSync(filePath).size;
			} catch {
				continue;
			}

			const pkg = extractModulePath(filePath) || '(other)';
			pkgSizes.set(pkg, (pkgSizes.get(pkg) || 0) + size);
		}
	}

	return Array.from(pkgSizes.entries())
		.map(([pkg, bytes]) => ({ pkg, bytes }))
		.sort((a, b) => b.bytes - a.bytes);
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

		// Go build cache: break down by package instead of by directory
		if (isGoBuildCache(resolved)) {
			const breakdown = analyzeGoBuildCache(resolved);
			const threshold = totalBytes * MIN_DISPLAY_FRAC;
			// Separate '(other)' (unidentified files) from named modules
			const named = breakdown.filter(e => e.pkg !== '(other)');
			const otherEntry = breakdown.find(e => e.pkg === '(other)');
			const above = named.filter(e => e.bytes >= threshold);
			const below = named.filter(e => e.bytes < threshold);
			for (const entry of above) {
				allRows.push({ path: `  ${entry.pkg}`, bytes: entry.bytes, human: humanSize(entry.bytes), isTotal: false });
			}
			if (below.length > 0) {
				const belowBytes = below.reduce((sum, e) => sum + e.bytes, 0);
				allRows.push({ path: `  (${below.length} other)`, bytes: belowBytes, human: humanSize(belowBytes), isTotal: false });
			}
			if (otherEntry && otherEntry.bytes > 0) {
				allRows.push({ path: `  (unidentified)`, bytes: otherEntry.bytes, human: humanSize(otherEntry.bytes), isTotal: false });
			}
		} else if (depth > 0) {
			const children = collectAtDepth(resolved, 0, depth);
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
		core.info(line);
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
