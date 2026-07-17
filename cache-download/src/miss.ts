// Download-only module (NOT one of the byte-identical files shared with
// cache-upload): decides what happens when the hand-off lookup misses.

/** What a hand-off lookup miss does to the step. */
export interface MissOutcome {
	/** true: fail the step (core.setFailed); false: log and continue. */
	fail: boolean;
	message: string;
}

/**
 * The `fail-if-missing` input defaults to 'true' in action.yml, so an unset
 * input means a miss HARD-FAILS the step — only an explicit 'false' lets the
 * job continue without its files (cache-hit stays 'false', cache-matched-key
 * empty). Either way the message names the hand-off, the exact key tried,
 * and the restore prefix, so a miss is never mysterious.
 */
export function missOutcome(name: string, key: string, restorePrefix: string, failIfMissing: boolean): MissOutcome {
	const detail = `Hand-off '${name}' was not found for this workflow run (tried exact key ${key}, then restore prefix ${restorePrefix})`;
	if (failIfMissing) {
		return {fail: true, message: `${detail}. Did the producing job run cache-upload with the same name?`};
	}
	return {fail: false, message: `${detail}; continuing without it (fail-if-missing is false)`};
}
