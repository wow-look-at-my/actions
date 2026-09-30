import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Cargo names every deps/, build/ and .fingerprint/ entry with the same 16-hex hash its JSON messages print.
const HASH = /-([0-9a-f]{16})(?:\.[^/]*)?$/;
const SUBDIRS = ['deps', 'build', '.fingerprint'];

export function entryHash(name: string): string | null {
	const match = HASH.exec(name);
	return match === null ? null : match[1];
}

/** The cargo commands the script builds with, one per line, blank lines dropped. */
export function cargoCommands(raw: string): string[][] {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map((line) => line.split(/\s+/));
}

/** A profile dir is the parent of a cached `deps`, `build` or `.fingerprint` path. */
export function profileDirs(paths: string[]): string[] {
	const dirs = new Set<string>();
	for (const p of paths) {
		const trimmed = p.replace(/\/+$/, '');
		if (SUBDIRS.includes(path.basename(trimmed))) {
			dirs.add(path.dirname(trimmed));
		}
	}
	return [...dirs].sort();
}

function run(cmd: string, args: string[], cwd: string): string {
	return childProcess.execFileSync(cmd, args, {cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit']});
}

/**
 * Everything that changes a registry artifact, as text. A lint table, a comment or a path
 * dependency in a manifest changes none of it, so none of it is here.
 */
export function keyInputs(cwd: string, env: NodeJS.ProcessEnv): string {
	const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--format-version', '1'], cwd));
	const members = new Set<string>(metadata.workspace_members);
	const external = (metadata.resolve.nodes as Array<{id: string; features: string[]; deps: Array<{pkg: string}>}>)
		.filter((node) => !members.has(node.id))
		.map((node) => JSON.stringify({id: node.id, features: [...node.features].sort(), deps: node.deps.map((d) => d.pkg).sort()}))
		.sort();
	const parts = ['== external packages', ...external, '== rustc', run('rustc', ['-vV'], cwd).trimEnd()];
	for (const file of ['rust-toolchain.toml', 'rust-toolchain', '.cargo/config.toml']) {
		const full = path.join(cwd, file);
		if (fs.existsSync(full)) {
			parts.push(`== ${file}`, fs.readFileSync(full, 'utf8').trimEnd());
		}
	}
	parts.push('== profile tables', ...profileTables(fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf8')));
	parts.push('== environment');
	for (const name of Object.keys(env).sort()) {
		if (/^(CARGO_PROFILE_\w+|CARGO_INCREMENTAL|RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(name)) {
			parts.push(`${name}=${env[name]}`);
		}
	}
	return parts.join('\n') + '\n';
}

/** The `[profile.*]` tables of a manifest, without blank or comment-only lines. */
export function profileTables(manifest: string): string[] {
	const out: string[] = [];
	let on = false;
	for (const line of manifest.split('\n')) {
		if (/^\s*\[/.test(line)) {
			on = /^\s*\[profile/.test(line);
		}
		if (on && !/^\s*(#.*)?$/.test(line)) {
			out.push(line.trimEnd());
		}
	}
	return out;
}

export function digestOf(text: string): string {
	return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40);
}

export interface Units {
	/** Hashes of units built from a path package: the workspace, which cannot be restored. */
	workspace: Set<string>;
	/** Hashes of units built from a registry or git package. */
	registry: Set<string>;
	/** Registry package ids by hash, for reporting. */
	names: Map<string, string>;
	/** Package ids of units the messages report as compiled rather than fresh. */
	compiled: string[];
	/** Workspace package and target names. A bin's messages name only its uplifted copy, so its entries carry no hash the messages print. */
	members: string[];
}

/** Whether an entry belongs to a workspace member: `<name>-`, `<name_>-` or `lib<name_>-`, then only the hash. */
export function isMemberEntry(entry: string, members: string[]): boolean {
	for (const name of members) {
		const under = name.replace(/-/g, '_');
		for (const stem of [`${name}-`, `${under}-`, `lib${under}-`]) {
			if (entry.startsWith(stem) && /^[0-9a-f]{16}(\.[^/]*)?$/.test(entry.slice(stem.length))) {
				return true;
			}
		}
	}
	return false;
}

/** Reads cargo's JSON messages. Every unit the build used appears, fresh or compiled. */
export function parseUnits(messages: string): Units {
	const units: Units = {workspace: new Set(), registry: new Set(), names: new Map(), compiled: [], members: []};
	for (const line of messages.split('\n')) {
		if (!line.startsWith('{')) {
			continue;
		}
		const msg = JSON.parse(line);
		if (msg.reason !== 'compiler-artifact' && msg.reason !== 'build-script-executed') {
			continue;
		}
		const files: string[] = [...(msg.filenames ?? []), ...(msg.out_dir ? [msg.out_dir] : []), ...(msg.executable ? [msg.executable] : [])];
		const isWorkspace = String(msg.package_id).startsWith('path+');
		if (msg.reason === 'compiler-artifact' && msg.fresh === false) {
			units.compiled.push(String(msg.package_id));
		}
		for (const file of files) {
			const match = /\/(?:deps|build)\/[^/]*-([0-9a-f]{16})/.exec(file);
			if (match === null) {
				continue;
			}
			(isWorkspace ? units.workspace : units.registry).add(match[1]);
			if (!isWorkspace) {
				units.names.set(match[1], String(msg.package_id));
			}
		}
	}
	return units;
}

/** Runs each command as a no-op query after the build, so every unit reports itself. */
export function queryUnits(commands: string[][], cwd: string): Units {
	let messages = '';
	for (const args of commands) {
		messages += run('cargo', [...args, '--message-format=json'], cwd);
	}
	const units = parseUnits(messages);
	const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1'], cwd));
	units.members = [
		...new Set<string>((metadata.packages as Array<{name: string; targets: Array<{name: string}>}>).flatMap((p) => [p.name, ...p.targets.map((t) => t.name)]))
	].sort();
	return units;
}

export interface SortResult {
	stashed: number;
	removed: number;
}

/**
 * Leaves only this build's registry units in a profile dir. Workspace units move to `stash`,
 * because the next step needs them. An entry no unit claims is left from an older dependency set.
 */
export function sortOut(dir: string, units: Units, stash: string): SortResult {
	const result: SortResult = {stashed: 0, removed: 0};
	if (units.workspace.size + units.registry.size === 0) {
		throw new Error('cargo reported no unit, so every entry would read as stale');
	}
	for (const sub of SUBDIRS) {
		const from = path.join(dir, sub);
		if (!fs.existsSync(from)) {
			continue;
		}
		for (const name of fs.readdirSync(from)) {
			const hash = entryHash(name);
			if (hash === null || units.registry.has(hash)) {
				continue;
			}
			const entry = path.join(from, name);
			if (units.workspace.has(hash) || isMemberEntry(name, units.members)) {
				fs.mkdirSync(path.join(stash, sub), {recursive: true});
				fs.renameSync(entry, path.join(stash, sub, name));
				result.stashed++;
			} else {
				fs.rmSync(entry, {recursive: true, force: true});
				result.removed++;
			}
		}
	}
	return result;
}

/** Moves stashed entries back. A rename keeps the mtimes, which is what cargo reads as fresh. */
export function putBack(stash: string, dir: string): number {
	let moved = 0;
	if (!fs.existsSync(stash)) {
		return moved;
	}
	for (const sub of fs.readdirSync(stash)) {
		fs.mkdirSync(path.join(dir, sub), {recursive: true});
		for (const name of fs.readdirSync(path.join(stash, sub))) {
			const dest = path.join(dir, sub, name);
			if (fs.existsSync(dest)) {
				throw new Error(`${dest} already exists, so the stash cannot go back`);
			}
			fs.renameSync(path.join(stash, sub, name), dest);
			moved++;
		}
	}
	fs.rmSync(stash, {recursive: true, force: true});
	return moved;
}

/** Registry units whose fingerprint changed after `sinceMs`, which on an exact hit means the key missed an input. */
export function compiledSince(dirs: string[], units: Units, sinceMs: number): string[] {
	const compiled = new Set<string>();
	for (const dir of dirs) {
		const fingerprints = path.join(dir, '.fingerprint');
		if (!fs.existsSync(fingerprints)) {
			continue;
		}
		for (const name of fs.readdirSync(fingerprints)) {
			const hash = entryHash(name);
			if (hash === null || !units.registry.has(hash)) {
				continue;
			}
			const unitDir = path.join(fingerprints, name);
			const newer = fs.readdirSync(unitDir).some((file) => fs.statSync(path.join(unitDir, file)).mtimeMs > sinceMs);
			if (newer) {
				compiled.add(units.names.get(hash) ?? name);
			}
		}
	}
	return [...compiled].sort();
}
