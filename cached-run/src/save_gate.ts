// Which refs may WRITE a cache entry. Reading is untouched: GitHub already
// lets any branch restore the default branch's entries, so a feature branch
// keeps every hit it had.
//
// A branch that writes gets its own scope, which only that branch can read.
// The entry costs the repository's shared cache budget and serves one ref. A
// multi-gigabyte dependency tree saved by every feature branch evicts the
// default branch's copy, which is the one every branch reads.

/** Which refs the caller allows to write an entry. */
export type SaveOn = 'default-branch' | 'any';

export const SAVE_ON_VALUES: SaveOn[] = ['default-branch', 'any'];

export interface SaveGateEnv {
	SAVE_ON?: string;
	GITHUB_REF?: string;
	DEFAULT_BRANCH?: string;
	// Present so `process.env` satisfies this type directly.
	[name: string]: string | undefined;
}

export interface SaveGate {
	/** Whether this ref may write an entry. */
	allowed: boolean;
	/** Why it may not, for the log. Empty when allowed. */
	reason: string;
	/** Whether `reason` names a fault rather than ordinary policy. */
	isWarning: boolean;
}

export function parseSaveOn(raw: string | undefined): SaveOn {
	const value = (raw ?? '').trim();
	if (value === '') {
		return 'default-branch';
	}
	if ((SAVE_ON_VALUES as string[]).includes(value)) {
		return value as SaveOn;
	}
	// A typo must not quietly pick a policy. Which refs may write is the whole
	// point of the input, and both answers look like success from the outside.
	throw new Error(
		`save-on is '${value}', which is not one of ${SAVE_ON_VALUES.join(', ')}`
	);
}

export function saveGate(env: SaveGateEnv): SaveGate {
	const saveOn = parseSaveOn(env.SAVE_ON);
	if (saveOn === 'any') {
		return {allowed: true, reason: '', isWarning: false};
	}

	const defaultBranch = (env.DEFAULT_BRANCH ?? '').trim();
	if (defaultBranch === '') {
		// The event payload carries no repository, so which branch is the default
		// one cannot be read. Refusing the write is the safe side: the cost is a
		// recompile, and allowing it spends the budget this input exists to
		// protect. Saying so is what keeps that from being a silent stand-down.
		return {
			allowed: false,
			reason:
				'this event carries no repository, so the default branch is unknown and no entry is written. Set save-on: any to write from every ref.',
			isWarning: true
		};
	}

	const ref = (env.GITHUB_REF ?? '').trim();
	// The full ref, never the short name: a TAG named after the default branch
	// is a different ref and must not be taken for it.
	if (ref === `refs/heads/${defaultBranch}`) {
		return {allowed: true, reason: '', isWarning: false};
	}
	return {
		allowed: false,
		reason: `save-on is default-branch and this ref is '${ref || '(unset)'}', so the run reuses entries and writes none`,
		isWarning: false
	};
}
