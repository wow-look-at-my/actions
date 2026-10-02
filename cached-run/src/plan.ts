import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import {buildKey, normalizeList} from '../../_shared/cache-key/lib';

// v2 stores the run's exports beside its output paths.
export const SCHEME = 'cached-run-v2';

export interface PlanEnv {
	RUN_SCRIPT?: string;
	RAW_PATHS?: string;
	EXTRA_KEY?: string;
	RUNNER_OS_NAME?: string;
	RUNNER_ARCH_NAME?: string;
	RUNNER_TEMP?: string;
	// Present so `process.env` satisfies this type directly.
	[name: string]: string | undefined;
}

export interface Plan {
	key: string;
	digest: string;
	sentinel: string;
	paths: string[];
	/** Where the run's exports to GITHUB_ENV and GITHUB_PATH are kept. */
	envDir: string;
	/** What the cache stores: the caller's paths, plus those exports. */
	cachePaths: string[];
	/** The key up to its digest. A restore-keys prefix that reaches every older entry of this label. */
	prefix: string;
	/** Where cargo mode moves workspace artifacts while the save runs. */
	stash: string;
}

function required(env: PlanEnv, name: 'RUNNER_OS_NAME' | 'RUNNER_ARCH_NAME'): string {
	const value = env[name];
	if (value === undefined || value === '') {
		throw new Error(`${name} is not set, so the cache key cannot name this platform`);
	}
	return value;
}

/** `cargoDigest` is the dependency-set digest in cargo mode. It keys the entry beside the script. */
export function plan(env: PlanEnv, cargoDigest = ''): Plan {
	// A composite runner does not enforce `required: true`, so an omitted input arrives as an empty string.
	const script = env.RUN_SCRIPT ?? '';
	if (script.trim() === '') {
		throw new Error('the run input is empty. Give it a script, or call actions/cache directly.');
	}
	const paths = normalizeList(env.RAW_PATHS ?? '');
	if (paths.length === 0) {
		throw new Error('the paths input is empty. Name at least one output path to cache.');
	}

	const {key, digest} = buildKey({
		scheme: SCHEME,
		platform: [required(env, 'RUNNER_OS_NAME'), required(env, 'RUNNER_ARCH_NAME')],
		label: env.EXTRA_KEY ?? '',
		// The script text and the path list both change what a hit MEANS.
		fields: cargoDigest === '' ? {run: script, paths} : {run: script, paths, cargo: cargoDigest}
	});

	const sentinel = path.join(env.RUNNER_TEMP ?? os.tmpdir(), `cached-run-${digest}.done`);
	// A skipped run exports nothing.
	const slot = crypto.createHash('sha256').update(JSON.stringify({label: env.EXTRA_KEY ?? '', paths}), 'utf8').digest('hex').slice(0, 16);
	const envDir = path.join(env.RUNNER_TEMP ?? os.tmpdir(), `cached-run-${slot}.env`);
	const stash = path.join(env.RUNNER_TEMP ?? os.tmpdir(), `cached-run-${digest}.stash`);
	const prefix = key.slice(0, key.length - digest.length);
	return {key, digest, sentinel, paths, envDir, cachePaths: [...paths, envDir], prefix, stash};
}
