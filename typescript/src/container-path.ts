// In a job container the runner mounts its work directory at a different root.

const SEGMENT = '/_actions/';

/** The `_actions` directory that dir sits in, or undefined when dir is not under one. */
export function actionsRoot(dir: string): string | undefined {
	const i = dir.indexOf(SEGMENT);
	return i < 0 ? undefined : dir.slice(0, i + SEGMENT.length - 1);
}

/**
 * Returns p unchanged when it exists. Otherwise it moves the part after
 * `/_actions/` onto root, and returns that path if it exists.
 */
export function containerPath(p: string, root: string | undefined, exists: (p: string) => boolean): string {
	if (root === undefined || exists(p)) return p;
	const i = p.indexOf(SEGMENT);
	if (i < 0) return p;
	const mapped = root + p.slice(i + SEGMENT.length - 1);
	return mapped !== p && exists(mapped) ? mapped : p;
}
