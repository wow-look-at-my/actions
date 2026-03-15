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

// Number of section kinds in Go's unified IR export format (internal/pkgbits).
const NUM_SECTIONS = 10; // SectionString=0 ... SectionBody=9

// Extract the package import path from a Go build cache data file by parsing
// the Go archive format: !<arch> → __.PKGDEF → $$B → unified IR export data.
// Returns the raw import path (e.g. "github.com/foo/bar", "net/http", "fmt").
function extractPackagePath(buf: Buffer, n: number): string | null {
	// Must be a Go archive
	if (n < 8 || buf.toString('ascii', 0, 8) !== '!<arch>\n') return null;

	// Find the $$B\n marker that starts binary export data
	const marker = Buffer.from('$$B\n');
	let pos = -1;
	for (let i = 8; i < n - 3; i++) {
		if (buf[i] === 0x24 && buf[i + 1] === 0x24 && buf[i + 2] === 0x42 && buf[i + 3] === 0x0a) {
			pos = i + 4;
			break;
		}
	}
	if (pos < 0 || pos >= n) return null;

	// Format byte — must be 'u' (unified IR)
	if (buf[pos] !== 0x75) return null; // 'u'
	pos++;

	// Version: uint32 LE
	if (pos + 4 > n) return null;
	const version = buf.readUInt32LE(pos);
	pos += 4;

	// Flags: uint32 LE (present in all current versions; version >= 1 has Flags)
	if (version >= 1) {
		if (pos + 4 > n) return null;
		pos += 4; // skip flags
	}

	// elemEndsEnds: NUM_SECTIONS × uint32 LE — cumulative element counts per section
	if (pos + NUM_SECTIONS * 4 > n) return null;
	const elemEndsEnds = new Uint32Array(NUM_SECTIONS);
	for (let i = 0; i < NUM_SECTIONS; i++) {
		elemEndsEnds[i] = buf.readUInt32LE(pos + i * 4);
	}
	pos += NUM_SECTIONS * 4;

	// elemEnds: totalElems × uint32 LE — cumulative byte offsets in elemData
	const totalElems = elemEndsEnds[NUM_SECTIONS - 1];
	if (pos + totalElems * 4 > n) return null;
	const elemEnds = new Uint32Array(totalElems);
	for (let i = 0; i < totalElems; i++) {
		elemEnds[i] = buf.readUInt32LE(pos + i * 4);
	}
	pos += totalElems * 4;

	// elemData starts at pos
	const elemDataStart = pos;

	// SectionString is section 0. String elements are indices 0..elemEndsEnds[0]-1.
	// SectionPkg is section 3. The first Pkg element contains the self-package path
	// as a reloc to a string. Rather than parsing relocation tables, we read all
	// string elements and find the one that looks like a package path.
	const numStrings = elemEndsEnds[0];
	for (let i = 0; i < numStrings && i < 64; i++) {
		const start = i === 0 ? 0 : elemEnds[i - 1];
		const end = elemEnds[i];
		if (elemDataStart + end > n) break;

		const raw = buf.toString('utf-8', elemDataStart + start, elemDataStart + end);
		// String elements in pkgbits have a relocation table prefix (SyncRelocs):
		// a uvarint count of relocs (usually 0 for strings), then the string data
		// prefixed with SyncString marker (if sync enabled, but usually disabled).
		// With no sync markers and 0 relocs, the first byte is 0x00 (varint 0)
		// followed by the raw string content.
		const str = raw[0] === '\x00' ? raw.slice(1) : raw;
		if (str.length === 0) continue;

		// Accept any valid Go import path
		if (isGoImportPath(str)) return str;
	}

	return null;
}

// Check if a string looks like a valid Go import path.
// Stdlib: single word or slash-separated words starting with lowercase (e.g. "fmt", "net/http")
// Third-party: domain/path (e.g. "github.com/foo/bar")
function isGoImportPath(s: string): boolean {
	if (s.length === 0 || s.length > 200) return false;
	// Must not contain spaces, control chars, or backslashes
	if (/[\s\\]/.test(s)) return false;
	// Must start with a lowercase letter
	if (!/^[a-z]/.test(s)) return false;
	// Each path component must be a valid Go identifier-like string
	const parts = s.split('/');
	return parts.every(p => /^[a-z][a-z0-9_.\-]*$/i.test(p) && p.length > 0);
}

// Normalize an import path to module level for aggregation.
function normalizeToModule(importPath: string): string {
	const parts = importPath.split('/');
	// Third-party: domain-based paths
	if (parts[0].includes('.')) {
		// github.com/org/repo, gitlab.com/org/repo → 3 components
		if (parts[0] === 'github.com' || parts[0] === 'gitlab.com') {
			return parts.slice(0, 3).join('/');
		}
		// golang.org/x/pkg → 3 components
		if (parts[0] === 'golang.org' && parts[1] === 'x') {
			return parts.slice(0, 3).join('/');
		}
		// gopkg.in/pkg → 2 components
		if (parts[0] === 'gopkg.in') {
			return parts.slice(0, 2).join('/');
		}
		// other domains: domain/pkg → 2 components
		return parts.slice(0, 2).join('/');
	}
	// Stdlib: group as "stdlib"
	return 'stdlib';
}

function extractModulePath(filePath: string): string | null {
	let fd: number;
	try {
		fd = fs.openSync(filePath, 'r');
	} catch {
		return null;
	}
	try {
		// Read enough to cover the archive header + export data header + string table.
		// The PKGDEF ar header is ~60 bytes, go object line ~50 bytes, $$B marker,
		// then the unified IR header. 256KB covers even large string tables.
		const buf = Buffer.alloc(256 * 1024);
		const n = fs.readSync(fd, buf, 0, buf.length, 0);

		const importPath = extractPackagePath(buf, n);
		if (!importPath) return null;

		return normalizeToModule(importPath);
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
