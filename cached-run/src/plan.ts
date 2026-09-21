import * as os from 'os';
import * as path from 'path';
import {buildKey, normalizeList} from '../../_shared/cache-key/lib';

export const SCHEME = 'cached-run-v1';

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
}

function required(env: PlanEnv, name: 'RUNNER_OS_NAME' | 'RUNNER_ARCH_NAME'): string {
	const value = env[name];
	if (value === undefined || value === '') {
		throw new Error(`${name} is not set, so the cache key cannot name this platform`);
	}
	return value;
}

export function plan(env: PlanEnv): Plan {
	// A composite runner does not enforce `required: true`, so an omitted input
	// arrives as an empty string. Taking it would cache whatever happened to be
	// at those paths under a key no script produced.
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
		fields: {run: script, paths}
	});

	// Derived from the digest, so two cached-run calls in one job never share a
	// sentinel and read each other's completion as their own.
	const sentinel = path.join(env.RUNNER_TEMP ?? os.tmpdir(), `cached-run-${digest}.done`);
	return {key, digest, sentinel, paths};
}
