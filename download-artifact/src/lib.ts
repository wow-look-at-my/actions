// Download-side helpers of the cache-backed download-artifact action.
// Input surface mirrors actions/download-artifact@v4 (MIT License,
// Copyright GitHub, Inc. and contributors); unsupported inputs are rejected
// loudly instead of silently ignored.

import {CacheEntry, CacheUsage, expectedCacheVersions, formatGB, KEY_VERSION} from './shared';

export interface UnsupportedInputs {
	pattern: string;
	mergeMultiple: boolean;
	artifactIds: string;
}

/**
 * Message rejecting upstream download-artifact inputs this implementation
 * cannot honor, or undefined when none are set. Accept-but-reject-loudly:
 * a call site relying on these must be converted deliberately, never left
 * silently downloading the wrong thing.
 */
export function rejectUnsupportedInputs(inputs: UnsupportedInputs): string | undefined {
	const rejected: string[] = [];
	if (inputs.pattern) {
		rejected.push('pattern');
	}
	if (inputs.mergeMultiple) {
		rejected.push('merge-multiple');
	}
	if (inputs.artifactIds) {
		rejected.push('artifact-ids');
	}
	if (rejected.length === 0) {
		return undefined;
	}
	const plural = rejected.length > 1;
	return (
		`The input${plural ? 's' : ''} ${rejected.join(', ')} ${plural ? 'are' : 'is'} not supported by the ` +
		'cache-backed download-artifact implementation; download one artifact per step by its explicit name.'
	);
}

export function repoMismatchMessage(requested: string, current: string): string {
	return (
		`Cache-backed artifacts are repo-scoped: cannot download from "${requested}" while running in ` +
		`"${current}". The Actions cache service has no cross-repository access; publish cross-repo ` +
		'deliverables to buildhost instead.'
	);
}

export function missingNameMessage(): string {
	return (
		'This cache-backed download-artifact needs an explicit artifact name: downloading all artifacts of a ' +
		'run is not supported (the cache service resolves exact keys only; there is no artifact listing). ' +
		'Set the name input to the artifact you want, one download step per artifact.'
	);
}

export interface MissDiagnosisContext {
	name: string;
	exactKey: string;
	runId: string;
	currentRef: string | undefined;
	/** REST listing for the exact key across refs; undefined = listing unavailable. */
	entriesForKey: CacheEntry[] | undefined;
	/** REST listing for this run's ghart key prefix; undefined = listing unavailable. */
	runEntries: CacheEntry[] | undefined;
	usage: CacheUsage | undefined;
}

/**
 * The compact one-paragraph verdict for a restore miss, naming the most
 * likely cause. The caller has already logged the detailed listings; this is
 * the setFailed text. NEVER a silent empty directory.
 */
export function buildMissVerdict(ctx: MissDiagnosisContext): string {
	const tail = ` Key: ${ctx.exactKey}`;
	if (ctx.entriesForKey && ctx.entriesForKey.length > 0) {
		const expected = expectedCacheVersions();
		const sameRef = ctx.currentRef ? ctx.entriesForKey.filter((e) => e.ref === ctx.currentRef) : [];
		const wrongVersion = sameRef.filter((e) => !expected.includes(e.version));
		if (wrongVersion.length > 0) {
			return (
				`Cache-backed artifact "${ctx.name}" was not restored although an entry for its exact key exists on ` +
				"this run's own ref with an unexpected cache version: the save and the restore passed different " +
				'payload paths or compression methods (mixed incompatible action versions, or a runner without ' +
				`zstd). Use the same ${KEY_VERSION} action release on both sides.` +
				tail
			);
		}
		if (sameRef.length > 0) {
			return (
				`Cache-backed artifact "${ctx.name}" was not restored although an entry for its exact key exists on ` +
				`this run's own ref (${sameRef[0].ref}) -- the restore should have hit. Most likely a transient ` +
				'cache-service failure (check the warnings above); re-run the job.' +
				tail
			);
		}
		const refs = [...new Set(ctx.entriesForKey.map((e) => e.ref))];
		return (
			`Cache-backed artifact "${ctx.name}" exists but only on ref${refs.length > 1 ? 's' : ''} ` +
			`${refs.join(', ')}, which this run (ref ${ctx.currentRef ?? 'unknown'}) cannot restore from: cache ` +
			'entries are branch-scoped (restorable from their own ref, PRs based on it, or the default branch). ' +
			'Download from a ref with access, or upload from a ref this one can see.' +
			tail
		);
	}
	if (ctx.runEntries && ctx.runEntries.length > 0) {
		const keys = ctx.runEntries.map((e) => e.key);
		return (
			`Cache-backed artifact "${ctx.name}" was never saved by run ${ctx.runId}: that run saved ` +
			`${keys.length} cache-backed artifact key${keys.length > 1 ? 's' : ''} (${keys.join(', ')}) and none ` +
			'matches this name -- most likely a name mismatch or typo between the upload and download steps.' +
			tail
		);
	}
	if (ctx.runEntries) {
		let evict = '';
		if (ctx.usage) {
			evict =
				` The repo cache holds ${formatGB(ctx.usage.active_caches_size_in_bytes)} of the ~10 GB cap ` +
				`(${ctx.usage.active_caches_count} entries); if the save succeeded earlier, the entry may have been ` +
				'LRU-evicted -- restore sooner after saving or shrink artifacts.';
		}
		return (
			`No cache-backed artifacts from run ${ctx.runId} exist at all: the upload step did not run, failed, ` +
			`or ran in a different run or repository.${evict}` +
			tail
		);
	}
	return (
		`Cache-backed artifact "${ctx.name}" was not found, and the REST miss diagnosis was unavailable ` +
		'(github-token lacks actions: read, or the API was unreachable). Check that the upload step ran in run ' +
		`${ctx.runId} of this repository, that both steps use the same name, and that this run's ref can see ` +
		"the upload's ref (cache entries are branch-scoped)." +
		tail
	);
}
