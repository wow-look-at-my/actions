import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {compiledSince, digestOf, isCargoProject, keyInputs, profileDirs, putBack, queryUnits, readInvocations, shimScript, sortOut} from './cargo';
import {normalizeList} from '../../_shared/cache-key/lib';
import {plan} from './plan';
import {saveGate} from './save_gate';

function planStep(): void {
	// Cargo mode is on when the cached paths hold a cargo profile dir and this directory is a cargo workspace.
	const cargo = profileDirs(normalizeList(process.env.RAW_PATHS ?? '')).length > 0 && isCargoProject(process.cwd());
	core.setOutput('cargo', String(cargo));
	let cargoDigest = '';
	if (cargo) {
		const inputs = keyInputs(process.cwd(), process.env);
		core.startGroup('cached-run: cargo key inputs');
		core.info(inputs);
		core.endGroup();
		cargoDigest = digestOf(inputs);
	}

	const result = plan(process.env, cargoDigest);
	core.setOutput('key', result.key);
	core.setOutput('digest', result.digest);
	core.setOutput('sentinel', result.sentinel);
	core.setOutput('paths', result.paths.join('\n'));
	core.setOutput('envdir', result.envDir);
	core.setOutput('cache-paths', result.cachePaths.join('\n'));
	core.setOutput('stash', result.stash);
	core.setOutput('started-ms', String(Date.now()));
	// Cargo mode falls back to the newest older entry of its own label unless the caller named prefixes.
	const restoreKeys = process.env.RESTORE_KEYS?.trim() || (cargo ? result.prefix : '');
	if (cargo) {
		const shimDir = path.join(process.env.RUNNER_TEMP ?? '/tmp', `cached-run-${result.digest}.bin`);
		fs.mkdirSync(shimDir, {recursive: true});
		fs.writeFileSync(path.join(shimDir, 'cargo'), shimScript(), {mode: 0o755});
		core.setOutput('shim-dir', shimDir);
		core.setOutput('cargo-log', path.join(process.env.RUNNER_TEMP ?? '/tmp', `cached-run-${result.digest}.calls`));
	}
	core.setOutput('restore-keys', restoreKeys);
	core.info(`cached-run key: ${result.key}`);
	core.info(`cached-run paths:\n${result.paths.join('\n')}`);
	if (restoreKeys !== '') {
		core.info(`cached-run restore-keys:\n${restoreKeys}`);
	}

	const gate = saveGate(process.env);
	core.setOutput('save-allowed', String(gate.allowed));
	if (gate.reason !== '') {
		// A ref that is not the default one is the policy working rather than a fault.
		const report = gate.isWarning ? core.warning : core.info;
		report(`cached-run: ${gate.reason}`);
	}
}

function postStep(): void {
	const dirs = profileDirs((process.env.PLAN_PATHS ?? '').split('\n'));
	const calls = readInvocations(process.env.CARGO_LOG ?? '');
	const units = queryUnits(calls, process.env.REAL_CARGO || 'cargo');
	if (units.workspace.size + units.registry.size === 0) {
		core.warning(`cached-run: the script ran no cargo build (${calls.length} cargo calls recorded), so the cached dirs are saved as they are`);
		return;
	}
	if (units.compiled.length > 0) {
		throw new Error(`the query after the run compiled ${units.compiled.length} units, so the cargo input is not what the script built. Put every flag and variable that changes the build in the cargo input or the step's env. First: ${units.compiled.slice(0, 5).join(' ')}`);
	}
	if (process.env.CACHE_HIT === 'true') {
		const compiled = compiledSince(dirs, units, Number(process.env.STARTED_MS));
		if (compiled.length > 0) {
			core.warning(`cached-run: the key hit, but ${compiled.length} registry units compiled. The key misses an input that changes the build set: ${compiled.join(' ')}`);
		} else {
			core.info('cached-run: the key hit and no registry unit compiled');
		}
	}
	dirs.forEach((dir, i) => {
		const r = sortOut(dir, units, `${process.env.STASH}/${i}`);
		core.info(`cached-run: ${dir}: set aside ${r.stashed} workspace entries, removed ${r.removed} stale entries`);
	});
}

function restoreStep(): void {
	const dirs = profileDirs((process.env.PLAN_PATHS ?? '').split('\n'));
	dirs.forEach((dir, i) => {
		core.info(`cached-run: ${dir}: put back ${putBack(`${process.env.STASH}/${i}`, dir)} workspace entries`);
	});
}

try {
	const phase = process.argv[2] ?? 'plan';
	if (phase === 'plan') {
		planStep();
	} else if (phase === 'post') {
		postStep();
	} else if (phase === 'restore') {
		restoreStep();
	} else {
		throw new Error(`unknown phase ${phase}`);
	}
} catch (error) {
	core.setFailed(`cached-run: ${error instanceof Error ? error.message : String(error)}`);
}
