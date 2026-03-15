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

// Show all entries above this fraction of their parent directory's total size
const MIN_DISPLAY_FRAC = 0.01;

// Go object file magic (cmd/internal/goobj)
const GOOBJ_MAGIC = '\x00go120ld';
// Block indices in goobj header Offsets array (cmd/internal/goobj/objfile.go)
const BLK_PKG_IDX = 1;
const BLK_FILE = 2;
// Number of blocks (determines Offsets array length)
const N_BLK = 15;
// goobj header: Magic(8) + Fingerprint(8) + Flags(4) + Offsets(N_BLK*4)
const GOOBJ_HEADER_SIZE = 8 + 8 + 4 + N_BLK * 4;
// String references in goobj are 8 bytes: uint32 length + uint32 offset
const STRING_REF_SIZE = 8;

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

// Detect Go toolchain directory (contains a go<version>/ subdirectory with bin/go).
function isGoToolchain(dir: string): boolean {
	try {
		const entries = fs.readdirSync(dir);
		return entries.some(e => /^go\d/.test(e) && fs.existsSync(path.join(dir, e, 'bin', 'go')));
	} catch {
		return false;
	}
}

// Read a little-endian uint32 from a buffer at the given offset.
function readUint32LE(buf: Buffer, off: number): number {
	return buf.readUInt32LE(off);
}

// Parse a Go archive to find the go object entry and return its offset within the file.
// Go archives: "!<arch>\n" followed by 60-byte entry headers.
// The __.PKGDEF entry can be very large (100+ KB of export data), so we parse
// entry headers to compute offsets and seek directly rather than reading everything.
// Returns the file offset where the goobj binary data starts (after the "\n!\n" text header end),
// or -1 if not found.
function findGoobjOffset(fd: number, fileSize: number): number {
	// Read archive magic
	const magicBuf = Buffer.alloc(8);
	if (fs.readSync(fd, magicBuf, 0, 8, 0) < 8) return -1;
	if (magicBuf.toString('ascii') !== '!<arch>\n') return -1;

	let pos = 8;
	const hdrBuf = Buffer.alloc(60);

	// Iterate archive entries by reading each 60-byte header
	while (pos + 60 <= fileSize) {
		if (fs.readSync(fd, hdrBuf, 0, 60, pos) < 60) return -1;
		const name = hdrBuf.toString('ascii', 0, 16).trimEnd();
		const sizeStr = hdrBuf.toString('ascii', 48, 58).trim();
		const entrySize = parseInt(sizeStr, 10);
		if (isNaN(entrySize)) return -1;
		pos += 60; // past entry header

		if (name === '__.PKGDEF' || name === 'preferlinkext' || name === 'dynimportfail') {
			// Skip non-object entries entirely (PKGDEF can be 100+ KB)
			pos += entrySize;
			if (entrySize & 1) pos++;
			continue;
		}

		// This should be the go object entry. Read its text header to find "\n!\n".
		// The text header is typically < 256 bytes.
		const textBuf = Buffer.alloc(Math.min(512, entrySize));
		const textRead = fs.readSync(fd, textBuf, 0, textBuf.length, pos);
		for (let i = 0; i + 2 < textRead; i++) {
			if (textBuf[i] === 0x0a && textBuf[i + 1] === 0x21 && textBuf[i + 2] === 0x0a) {
				return pos + i + 3;
			}
		}
		// Skip this entry if no text header end found
		pos += entrySize;
		if (entrySize & 1) pos++;
	}
	return -1;
}

// Extract source file paths and package paths from a Go build cache data file
// by parsing the goobj binary format.
//
// Go build cache -d files are Go archives containing:
//   1. __.PKGDEF (export data)
//   2. Go object entries with goobj binary format (magic "\x00go120ld")
//
// The goobj format (cmd/internal/goobj/objfile.go) has:
//   Header: Magic(8) + Fingerprint(8) + Flags(4) + Offsets(NBlk*4)
//   Then data blocks including:
//     - Strings: raw string bytes
//     - PkgIndex: imported package paths (string refs)
//     - Files: source file paths (string refs)
//
// String refs are 8 bytes: uint32 length + uint32 offset (into the goobj data).
function extractModulePath(filePath: string): string | null {
	let fd: number;
	let fileSize: number;
	try {
		fd = fs.openSync(filePath, 'r');
		fileSize = fs.fstatSync(fd).size;
	} catch {
		return null;
	}
	try {
		const goobjFileOffset = findGoobjOffset(fd, fileSize);
		if (goobjFileOffset < 0) return null;

		// Read the goobj header
		const hdrBuf = Buffer.alloc(GOOBJ_HEADER_SIZE);
		const hdrRead = fs.readSync(fd, hdrBuf, 0, GOOBJ_HEADER_SIZE, goobjFileOffset);
		if (hdrRead < GOOBJ_HEADER_SIZE) return null;

		// Verify magic
		if (hdrBuf.toString('ascii', 0, 8) !== GOOBJ_MAGIC) return null;

		// Read block offsets (after Magic:8 + Fingerprint:8 + Flags:4 = 20)
		const offsets: number[] = [];
		for (let i = 0; i < N_BLK; i++) {
			offsets.push(readUint32LE(hdrBuf, 20 + i * 4));
		}

		// Try Files block first (BlkFile=2) — source file paths contain module paths
		const mod = readModuleFromBlock(fd, goobjFileOffset, offsets[BLK_FILE], offsets[BLK_FILE + 1], true);
		if (mod) return mod;

		// Fall back to PkgIndex block (BlkPkgIdx=1) — imported package paths
		return readModuleFromBlock(fd, goobjFileOffset, offsets[BLK_PKG_IDX], offsets[BLK_PKG_IDX + 1], false);
	} finally {
		fs.closeSync(fd);
	}
}

// Read string references from a goobj block and extract a module path.
// If isFilePaths is true, strings are source file paths (extract module from path).
// Otherwise, strings are package import paths (extract module directly).
function readModuleFromBlock(
	fd: number, goobjBase: number,
	blockStart: number, blockEnd: number,
	isFilePaths: boolean,
): string | null {
	const blockSize = blockEnd - blockStart;
	if (blockSize < STRING_REF_SIZE) return null;

	const entryCount = Math.floor(blockSize / STRING_REF_SIZE);
	// Read all string refs in the block
	const refBuf = Buffer.alloc(blockSize);
	fs.readSync(fd, refBuf, 0, blockSize, goobjBase + blockStart);

	// Also need to read the strings data. The strings block is at the start
	// of goobj data, from byte GOOBJ_HEADER_SIZE to offsets[0] (BlkAutolib).
	// But string offsets are absolute from the goobj start, so we just read
	// individual strings on demand using their offset+length.

	for (let i = 0; i < Math.min(entryCount, 20); i++) {
		const strLen = readUint32LE(refBuf, i * STRING_REF_SIZE);
		const strOff = readUint32LE(refBuf, i * STRING_REF_SIZE + 4);
		if (strLen === 0 || strLen > 4096) continue;

		const strBuf = Buffer.alloc(strLen);
		const read = fs.readSync(fd, strBuf, 0, strLen, goobjBase + strOff);
		if (read < strLen) continue;

		const str = strBuf.toString('utf-8');
		// Skip compiler-generated wrapper files
		if (str === '<autogenerated>') continue;

		const mod = isFilePaths ? moduleFromFilePath(str) : moduleFromImportPath(str);
		if (mod) return mod;
	}
	return null;
}

// Extract a module path from a Go source file path.
// The Go compiler stores paths in the Files block as:
//   - $GOROOT/src/runtime/proc.go           (stdlib)
//   - $GOROOT/src/vendor/golang.org/x/...   (vendored in stdlib)
//   - /home/runner/go/pkg/mod/golang.org/x/net@v0.33.0/http2/hpack/encode.go (module cache)
//   - /home/runner/work/repo/internal/foo.go (local source)
function moduleFromFilePath(filePath: string): string | null {
	// $GOROOT/src/... is stdlib (including vendored deps)
	if (filePath.startsWith('$GOROOT/')) {
		return 'stdlib';
	}

	// Module cache path: /pkg/mod/<module>@<version>/...
	const modIdx = filePath.indexOf('/pkg/mod/');
	if (modIdx >= 0) {
		const modPath = filePath.substring(modIdx + 9); // after "/pkg/mod/"
		const atIdx = modPath.indexOf('@');
		if (atIdx > 0) {
			return normalizeModulePath(modPath.substring(0, atIdx));
		}
	}

	// Fallback stdlib detection: /src/<pkg>/ where <pkg> has no dots
	const srcIdx = filePath.lastIndexOf('/src/');
	if (srcIdx >= 0 && !filePath.includes('/pkg/mod/')) {
		const afterSrc = filePath.substring(srcIdx + 5);
		const firstSlash = afterSrc.indexOf('/');
		const firstPkg = firstSlash >= 0 ? afterSrc.substring(0, firstSlash) : afterSrc;
		if (firstPkg && !firstPkg.includes('.')) {
			return 'stdlib';
		}
	}

	// Local project source — not from module cache or GOROOT
	return 'local';
}

// Extract a module path from a Go import path (from PkgIndex).
function moduleFromImportPath(importPath: string): string | null {
	// Skip stdlib packages (no dots in first path component)
	const firstSlash = importPath.indexOf('/');
	const firstComponent = firstSlash >= 0 ? importPath.substring(0, firstSlash) : importPath;
	if (!firstComponent.includes('.')) return null;

	return normalizeModulePath(importPath);
}

// Normalize an import/module path to the module root level.
function normalizeModulePath(raw: string): string {
	// Strip @version suffixes
	const cleaned = raw.replace(/@[^/]*/g, '');
	const parts = cleaned.split('/');

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

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	// If this directory has a single subdirectory child (and only small files
	// otherwise), pass through it without counting as a depth level. This
	// flattens structures like cache/ → cache/download/ → domain dirs.
	const subdirs = entries.filter(e => e.isDirectory());
	if (subdirs.length === 1) {
		return collectAtDepth(path.join(dir, subdirs[0].name), currentDepth, maxDepth);
	}

	if (currentDepth >= maxDepth) {
		const bytes = dirSize(dir);
		return [{ path: dir, bytes, human: humanSize(bytes) }];
	}

	const results: SizeEntry[] = [];
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

			// Separate unidentified from named entries
			const unidentifiedEntry = breakdown.find(e => e.pkg === '(other)');
			const named = breakdown.filter(e => e.pkg !== '(other)');

			const aboveThreshold = named.filter(e => e.bytes >= threshold);
			const belowThreshold = named.filter(e => e.bytes < threshold);

			for (const entry of aboveThreshold) {
				allRows.push({ path: `  ${entry.pkg}`, bytes: entry.bytes, human: humanSize(entry.bytes), isTotal: false });
			}
			if (belowThreshold.length > 0) {
				const belowBytes = belowThreshold.reduce((sum, e) => sum + e.bytes, 0);
				allRows.push({ path: `  (${belowThreshold.length} other)`, bytes: belowBytes, human: humanSize(belowBytes), isTotal: false });
			}
			if (unidentifiedEntry && unidentifiedEntry.bytes > 0) {
				allRows.push({ path: `  (unidentified)`, bytes: unidentifiedEntry.bytes, human: humanSize(unidentifiedEntry.bytes), isTotal: false });
			}
		} else if (depth > 0) {
			// Go toolchain dirs benefit from extra depth to show contents of
			// src/ and pkg/ rather than just listing top-level folders.
			const effectiveDepth = isGoToolchain(resolved) ? Math.max(depth, 2) : depth;
			const children = collectAtDepth(resolved, 0, effectiveDepth);
			children.sort((a, b) => b.bytes - a.bytes);
			const threshold = totalBytes * MIN_DISPLAY_FRAC;
			const aboveThreshold = children.filter(c => c.bytes >= threshold);
			const belowThreshold = children.filter(c => c.bytes < threshold);
			for (const child of aboveThreshold) {
				const rel = path.relative(resolved, child.path);
				allRows.push({ path: `  ${rel}`, bytes: child.bytes, human: child.human, isTotal: false });
			}
			if (belowThreshold.length > 0) {
				const belowBytes = belowThreshold.reduce((sum, c) => sum + c.bytes, 0);
				allRows.push({ path: `  (${belowThreshold.length} other)`, bytes: belowBytes, human: humanSize(belowBytes), isTotal: false });
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
