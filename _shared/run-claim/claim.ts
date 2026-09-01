import * as crypto from 'crypto';

/** Key prefix of every run-once claim entry. */
export const KEY_PREFIX = 'run-once';

/** Seed of the constant cache "version" sent with every claim RPC. */
export const VERSION_SEED = 'wow-look-at-my/actions/run-once/v1';

/** Body of a claim entry. The bytes carry no meaning; the key existing does. */
export const CLAIM_PAYLOAD = 'wow-look-at-my/actions run-once claim\n';

/** The cache service rejects keys longer than 512 characters. */
const MAX_KEY_LENGTH = 512;

export function validateName(name: string): void {
	if (!name) {
		throw new Error("The 'name' input must not be empty");
	}
	if (name.includes(',')) {
		throw new Error("The 'name' input must not contain commas (commas are invalid in cache keys)");
	}
}

/**
 * Exact key for this claim: unique per (run, attempt, name).
 *
 * The attempt is part of the key, so "re-run failed jobs" claims afresh
 * instead of skipping every job of the new attempt.
 */
export function claimKey(name: string, runId: string, runAttempt: string): string {
	const key = `${KEY_PREFIX}-${runId}-${runAttempt}-${name}`;
	if (key.length > MAX_KEY_LENGTH) {
		throw new Error(`Claim key is ${key.length} characters; the cache service allows at most ${MAX_KEY_LENGTH}. Use a shorter 'name'.`);
	}
	return key;
}

export function claimVersion(): string {
	return crypto.createHash('sha256').update(VERSION_SEED).digest('hex');
}

export interface CreateResult {
	ok: boolean;
	message?: string;
	signedUploadUrl?: string;
}

export interface FinalizeResult {
	ok: boolean;
	message?: string;
}

/** The four cache-service calls a claim needs, injected so the logic is testable. */
export interface ClaimService {
	create(key: string, version: string): Promise<CreateResult>;
	upload(signedUploadUrl: string): Promise<number>;
	finalize(key: string, version: string, sizeBytes: number): Promise<FinalizeResult>;
	exists(key: string, version: string): Promise<boolean>;
}

export interface ClaimOutcome {
	first: boolean;
	reason: string;
	warning?: string;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Claim the run for this job.
 *
 * `first` is true when this job holds the claim and the work behind it runs
 * here. Every failure mode outside a genuine collision returns first=true with
 * a warning: running a check twice costs seconds, and skipping it everywhere
 * because the cache service misbehaved hides whatever the check would report.
 */
export async function claimRun(service: ClaimService, key: string, version: string): Promise<ClaimOutcome> {
	let created: CreateResult;
	try {
		created = await service.create(key, version);
	} catch (error) {
		return {first: true, reason: 'the claim could not be attempted, so this job runs the work', warning: `run-once could not reach the cache service: ${messageOf(error)}`};
	}

	if (!created.ok) {
		let taken = false;
		let lookupError: string | undefined;
		try {
			taken = await service.exists(key, version);
		} catch (error) {
			lookupError = messageOf(error);
		}
		if (taken) {
			return {first: false, reason: `another job of this run holds the claim ${key}`};
		}
		const detail = lookupError ?? created.message ?? 'the service gave no message';
		return {first: true, reason: 'the claim was refused with no entry to show for it, so this job runs the work', warning: `run-once could not claim ${key}: ${detail}`};
	}

	if (!created.signedUploadUrl) {
		return {first: true, reason: 'the claim reservation carried no upload URL, so this job runs the work', warning: `run-once reserved ${key} but the service returned no upload URL`};
	}

	try {
		const sizeBytes = await service.upload(created.signedUploadUrl);
		const finalized = await service.finalize(key, version, sizeBytes);
		if (!finalized.ok) {
			return {first: true, reason: 'the claim never became visible to other jobs, so this job runs the work', warning: `run-once could not finalize ${key}${finalized.message ? `: ${finalized.message}` : ''}`};
		}
	} catch (error) {
		return {first: true, reason: 'the claim never became visible to other jobs, so this job runs the work', warning: `run-once could not store ${key}: ${messageOf(error)}`};
	}

	return {first: true, reason: `this job claimed ${key}`};
}
