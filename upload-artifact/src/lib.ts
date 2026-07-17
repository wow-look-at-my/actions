// Upload-side helpers of the cache-backed upload-artifact action.
//
// The artifact-name / file-path validation rules are ported from
// actions/toolkit @actions/artifact 2.3.2
// internal/upload/path-and-artifact-name-validation.ts (MIT License,
// Copyright GitHub, Inc. and contributors).

import {CACHE_WRITER_EVENTS, CacheEntry, cacheModeBlocksWrites, formatBytes} from './shared';

/**
 * Invalid characters that cannot be in the artifact name or an uploaded file.
 * These characters are not allowed due to limitations with certain file
 * systems such as NTFS. To maintain platform-agnostic behavior, all
 * characters that are not supported by an individual filesystem/platform are
 * not supported on all filesystems/platforms.
 *
 * File paths can include characters such as \ and / which are not permitted
 * in the artifact name alone.
 */
const invalidArtifactFilePathCharacters = new Map<string, string>([
	['"', ' Double quote "'],
	[':', ' Colon :'],
	['<', ' Less than <'],
	['>', ' Greater than >'],
	['|', ' Vertical bar |'],
	['*', ' Asterisk *'],
	['?', ' Question mark ?'],
	['\r', ' Carriage return \\r'],
	['\n', ' Line feed \\n']
]);

const invalidArtifactNameCharacters = new Map<string, string>([
	...invalidArtifactFilePathCharacters,
	['\\', ' Backslash \\'],
	['/', ' Forward slash /']
]);

/**
 * Validates the name of the artifact to check to make sure there are no
 * illegal characters (upstream upload-artifact rules).
 */
export function validateArtifactName(name: string): void {
	if (!name) {
		throw new Error('Provided artifact name input during validation is empty');
	}

	for (const [invalidCharacterKey, errorMessageForCharacter] of invalidArtifactNameCharacters) {
		if (name.includes(invalidCharacterKey)) {
			throw new Error(
				`The artifact name is not valid: ${name}. Contains the following character: ${errorMessageForCharacter}. ` +
					`Invalid characters include: ${Array.from(invalidArtifactNameCharacters.values()).toString()}. ` +
					'These characters are not allowed in the artifact name due to limitations with certain file systems ' +
					'such as NTFS. To maintain file system agnostic behavior, these characters are intentionally not ' +
					'allowed to prevent potential problems with downloads on different file systems.'
			);
		}
	}
}

/**
 * Validates a file path (as stored inside the payload) for illegal characters
 * that can cause problems on different file systems (upstream rules).
 */
export function validateFilePath(filePath: string): void {
	if (!filePath) {
		throw new Error('Provided file path input during validation is empty');
	}

	for (const [invalidCharacterKey, errorMessageForCharacter] of invalidArtifactFilePathCharacters) {
		if (filePath.includes(invalidCharacterKey)) {
			throw new Error(
				`The path for one of the files in artifact is not valid: ${filePath}. Contains the following character: ${errorMessageForCharacter}. ` +
					`Invalid characters include: ${Array.from(invalidArtifactFilePathCharacters.values()).toString()}. ` +
					'These characters are not allowed in files that are uploaded due to limitations with certain file systems ' +
					'such as NTFS. To maintain file system agnostic behavior, these characters are intentionally not allowed ' +
					'to prevent potential problems with downloads on different file systems.'
			);
		}
	}
}

export type NoFilesBehavior = 'warn' | 'error' | 'ignore';

/** Parse the if-no-files-found input; undefined for an unrecognized value. */
export function parseNoFilesBehavior(value: string): NoFilesBehavior | undefined {
	return value === 'warn' || value === 'error' || value === 'ignore' ? value : undefined;
}

/** The upstream-equivalent zero-files message (same text on all three channels). */
export function noFilesMessage(searchPath: string): string {
	return `No files were found with the provided path: ${searchPath}. No artifacts will be uploaded.`;
}

/**
 * The loud read-only-cache failure: runs from low-trust triggers
 * (workflow_run, pull_request_target, issue_comment, ...) resolving to the
 * default branch get read-only cache tokens and can never save.
 */
export function readOnlyCacheMessage(mode: string, eventName: string | undefined): string {
	return (
		`The Actions cache is read-only in this workflow run (ACTIONS_CACHE_MODE=${mode}` +
		(eventName ? `, event "${eventName}"` : '') +
		'), so a cache-backed artifact cannot be uploaded from it. GitHub gives read-only cache access to runs ' +
		'triggered by events like workflow_run, pull_request_target, and issue_comment when they resolve to the ' +
		'default branch. Only these triggers can write caches in the default-branch scope: ' +
		`${CACHE_WRITER_EVENTS.join(', ')}. ` +
		'(pull_request and release runs use non-default-branch scopes and can also write.) ' +
		'Move this upload into a workflow triggered by a cache-writer event.'
	);
}

export interface SaveFailureContext {
	name: string;
	key: string;
	/** Entries the REST cache list returned for the exact key; undefined = listing unavailable. */
	entriesForKey: CacheEntry[] | undefined;
	cacheMode: string | undefined;
	eventName: string | undefined;
	rawError: string;
}

/**
 * Choose the failure message for a saveCache that returned -1 or threw.
 * saveCache collapses duplicate-key, write-denied, and most upload failures
 * into a bare -1, so the caller lists the exact key over REST first and this
 * chooser names the most likely cause. NEVER a silent -1.
 */
export function chooseSaveFailureDiagnosis(ctx: SaveFailureContext): string {
	if (ctx.entriesForKey && ctx.entriesForKey.length > 0) {
		const entries = ctx.entriesForKey
			.map((e) => `[id ${e.id}, ref ${e.ref}, created ${e.created_at}, ${formatBytes(e.size_in_bytes)}]`)
			.join(', ');
		return (
			`Failed to save cache-backed artifact "${ctx.name}": the cache key already exists and cache entries are ` +
			`immutable. Existing: ${entries}. Artifact names must be unique per run -- use a per-matrix-leg name ` +
			'(for example append the matrix os/leg to the name input) or set overwrite: true to delete and re-save. ' +
			`Key: ${ctx.key}`
		);
	}
	if (cacheModeBlocksWrites(ctx.cacheMode)) {
		return readOnlyCacheMessage(ctx.cacheMode as string, ctx.eventName);
	}
	return (
		`Failed to save cache-backed artifact "${ctx.name}": the cache backend refused the save and no existing ` +
		`entry holds the key (so this is not a duplicate-name conflict). Raw error: ${ctx.rawError}. ` +
		`Key: ${ctx.key}. If this persists, check the repository's cache settings and the Actions service status.`
	);
}
