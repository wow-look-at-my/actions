import * as assert from 'assert';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {test} from 'node:test';
import {compiledSince, digestOf, entryHash, keyInputs, parseUnits, profileDirs, profileTables, putBack, queryUnits, sortOut} from './cargo';

const H_APP = 'aaaaaaaaaaaaaaaa';
const H_SERDE = '1111111111111111';
const H_SERDE_BUILD = '2222222222222222';
const H_OLD = '9999999999999999';

function tmp(name: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `cached-run-${name}-`));
}

function touch(file: string): void {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, 'x');
}

function messages(profile: string): string {
	return [
		{reason: 'compiler-artifact', package_id: 'path+file:///w/app#0.1.0', fresh: true, filenames: [`${profile}/deps/app-${H_APP}`], executable: `${profile}/deps/app-${H_APP}`},
		{reason: 'compiler-artifact', package_id: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.0', fresh: true, filenames: [`${profile}/deps/libserde-${H_SERDE}.rlib`]},
		{reason: 'build-script-executed', package_id: 'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.0', out_dir: `${profile}/build/serde-${H_SERDE_BUILD}/out`},
		{reason: 'build-finished', success: true}
	]
		.map((m) => JSON.stringify(m))
		.join('\n');
}

test('an entry hash is the 16-hex stem suffix, with or without an extension', () => {
	assert.strictEqual(entryHash(`libserde-${H_SERDE}.rlib`), H_SERDE);
	assert.strictEqual(entryHash(`serde-${H_SERDE}`), H_SERDE);
	assert.strictEqual(entryHash('.cargo-lock'), null);
	assert.strictEqual(entryHash('serde-1111'), null);
});

test('profile dirs are the parents of cached deps, build and .fingerprint paths', () => {
	assert.deepStrictEqual(
		profileDirs(['~/.cargo/registry/cache', 'target/debug/deps', 'target/debug/build/', 'target/x/release/.fingerprint']),
		['target/debug', 'target/x/release']
	);
});

test('units split into workspace and registry by package source', () => {
	const units = parseUnits(messages('/t/debug'));
	assert.deepStrictEqual([...units.workspace], [H_APP]);
	assert.deepStrictEqual([...units.registry].sort(), [H_SERDE, H_SERDE_BUILD]);
	assert.deepStrictEqual(units.compiled, []);
});

test('a compiled unit in the messages is reported', () => {
	const line = JSON.stringify({reason: 'compiler-artifact', package_id: 'registry+x#jemalloc-sys@0.5.4', fresh: false, filenames: [`/t/deps/libjemalloc_sys-${H_OLD}.rlib`]});
	assert.deepStrictEqual(parseUnits(line).compiled, ['registry+x#jemalloc-sys@0.5.4']);
});

test('sorting keeps live registry entries, sets the workspace aside and drops the stale', () => {
	const root = tmp('sort');
	const profile = path.join(root, 'target/debug');
	const stash = path.join(root, 'stash');
	// The bin's messages name only its uplifted copy, so only its member name marks these as workspace.
	const workspace = [`deps/app-${H_APP}`, `deps/app-${H_APP}.d`, `.fingerprint/app-${H_APP}/bin-app`, `deps/my_tool-${H_OLD}`, `.fingerprint/my-tool-${H_OLD}/bin-my-tool`];
	const registry = [`deps/libserde-${H_SERDE}.rlib`, `.fingerprint/serde-${H_SERDE}/lib-serde`, `build/serde-${H_SERDE_BUILD}/out/x`];
	const stale = [`deps/libserde-${H_OLD}.rlib`, `.fingerprint/serde-${H_OLD}/lib-serde`, `deps/libapp_extra-${H_OLD}.rlib`];
	const unhashed = ['.fingerprint/.cargo-lock'];
	for (const rel of [...workspace, ...registry, ...stale, ...unhashed]) {
		touch(path.join(profile, rel));
	}
	const before = fs.statSync(path.join(profile, workspace[0])).mtimeMs;

	const units = parseUnits(messages(profile));
	units.members = ['app', 'my-tool'];
	const result = sortOut(profile, units, stash);
	assert.deepStrictEqual(result, {stashed: 5, removed: 3});
	for (const rel of workspace) {
		assert.ok(!fs.existsSync(path.join(profile, rel)), `${rel} stayed in the cached dir, so the entry carries a workspace artifact`);
	}
	for (const rel of [...registry, ...unhashed]) {
		assert.ok(fs.existsSync(path.join(profile, rel)), `${rel} was taken, so the entry loses a registry artifact it exists to hold`);
	}
	for (const rel of stale) {
		assert.ok(!fs.existsSync(path.join(profile, rel)), `${rel} survived, so a fallback restore grows the entry with every dependency change`);
	}

	assert.strictEqual(putBack(stash, profile), 5);
	for (const rel of workspace) {
		assert.ok(fs.existsSync(path.join(profile, rel)), `${rel} did not come back, so the next step compiles the workspace again`);
	}
	assert.strictEqual(fs.statSync(path.join(profile, workspace[0])).mtimeMs, before, 'a put-back entry has a new mtime, so cargo rebuilds it');
	assert.ok(!fs.existsSync(stash), 'the stash was left behind');
	assert.strictEqual(putBack(stash, profile), 0, 'a missing stash is nothing to put back');
});

test('sorting refuses a query that named no unit, which would delete every entry', () => {
	const profile = path.join(tmp('empty'), 'target/debug');
	touch(path.join(profile, `deps/libserde-${H_SERDE}.rlib`));
	assert.throws(() => sortOut(profile, parseUnits(''), path.join(profile, '..', 'stash')), /no unit/);
	assert.ok(fs.existsSync(path.join(profile, `deps/libserde-${H_SERDE}.rlib`)));
});

test('a registry fingerprint written after the plan reads as compiled', () => {
	const profile = path.join(tmp('since'), 'target/debug');
	touch(path.join(profile, `.fingerprint/serde-${H_SERDE}/lib-serde`));
	const units = parseUnits(messages(profile));
	const old = new Date(Date.now() - 60_000);
	fs.utimesSync(path.join(profile, `.fingerprint/serde-${H_SERDE}/lib-serde`), old, old);
	assert.deepStrictEqual(compiledSince([profile], units, Date.now() - 30_000), []);
	touch(path.join(profile, `.fingerprint/serde-${H_SERDE}/lib-serde`));
	assert.deepStrictEqual(compiledSince([profile], units, Date.now() - 30_000), ['registry+https://github.com/rust-lang/crates.io-index#serde@1.0.0']);
});

test('profile tables drop blank and comment-only lines and stop at the next table', () => {
	const manifest = '[workspace]\nmembers = []\n\n[profile.release]\n# why\nlto = true\n\n[workspace.lints.clippy]\nunwrap_used = "deny"\n';
	assert.deepStrictEqual(profileTables(manifest), ['[profile.release]', 'lto = true']);
});

function workspace(root: string): void {
	const write = (rel: string, body: string) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
		fs.writeFileSync(path.join(root, rel), body);
	};
	write('Cargo.toml', '[workspace]\nmembers = ["app", "lib"]\nresolver = "2"\n\n[profile.dev]\nopt-level = 0\n');
	write('lib/Cargo.toml', '[package]\nname = "stash-lib"\nversion = "0.1.0"\nedition = "2021"\n');
	write('lib/src/lib.rs', 'pub fn n() -> u32 { 7 }\n');
	write('app/Cargo.toml', '[package]\nname = "stash-app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nstash-lib = { path = "../lib" }\n');
	write('app/src/main.rs', 'fn main() { println!("{}", stash_lib::n()); }\n');
}

test('the key follows profile tables and ignores lint tables and comments', () => {
	const root = tmp('key');
	workspace(root);
	childProcess.execFileSync('cargo', ['generate-lockfile', '--offline'], {cwd: root, stdio: 'ignore'});
	const base = digestOf(keyInputs(root, {}));
	fs.appendFileSync(path.join(root, 'Cargo.toml'), '\n# a comment\n[workspace.lints.clippy]\nunwrap_used = "deny"\n');
	assert.strictEqual(digestOf(keyInputs(root, {})), base, 'a lint table moved the key');
	fs.appendFileSync(path.join(root, 'Cargo.toml'), '\n[profile.release]\noverflow-checks = true\n');
	assert.notStrictEqual(digestOf(keyInputs(root, {})), base, 'a profile table left the key alone');
	assert.ok(keyInputs(root, {CARGO_PROFILE_DEV_DEBUG: '0'}).includes('CARGO_PROFILE_DEV_DEBUG=0'), 'the key inputs omit the profile environment');
});

test('after sorting and putting back, cargo builds nothing and the query compiles nothing', () => {
	const root = tmp('cargo');
	workspace(root);
	const target = path.join(root, 'target');
	const build = () =>
		childProcess.spawnSync('cargo', ['build', '--offline', '-p', 'stash-app', '--target-dir', target], {cwd: root, encoding: 'utf8'});
	assert.strictEqual(build().status, 0);

	const units = queryUnits([['build', '--offline', '-p', 'stash-app', '--target-dir', target]], root);
	assert.deepStrictEqual(units.compiled, [], 'the query after a build compiled something');
	assert.strictEqual(units.workspace.size > 0, true, 'the query named no workspace unit');

	const profile = path.join(target, 'debug');
	const stash = path.join(root, 'stash');
	assert.ok(sortOut(profile, units, stash).stashed > 0);
	putBack(stash, profile);

	const second = build();
	assert.strictEqual(second.status, 0);
	assert.ok(!second.stderr.includes('Compiling'), `cargo recompiled after the put-back, so CI compiles the workspace twice:\n${second.stderr}`);
});
