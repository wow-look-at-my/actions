// Download-only module (NOT part of the shared cache-xfer sources used by cache-upload).

import {nameFromKey} from '../../_shared/cache-xfer/lib';

/**
 * Distinct current-layout hand-off names among the listed keys of run
 * `runId`, in listing order. Attempts dedupe by construction (the attempt
 * segment is stripped), so a re-run never manufactures ambiguity; old-layout
 * and foreign keys are ignored.
 */
export function distinctHandoffNames(keys: string[], runId: string): string[] {
	const names: string[] = [];
	for (const key of keys) {
		const name = nameFromKey(key, runId);
		if (name !== undefined && !names.includes(name)) {
			names.push(name);
		}
	}
	return names;
}

/** The hard-error for an ambiguous nameless download. Deliberately a refusal, never a silent pick: the candidates are named so the fix ("pass one of these as `name`", or stop producing the extra hand-off) is obvious. */
export function ambiguityMessage(names: string[]): string {
	const listed = names.map(n => `'${n}'`).join(', ');
	return `This run saved ${names.length} distinct hand-offs (${listed}); a nameless cache-download refuses to pick one. Pass one of them as the 'name' input, or stop uploading the extra hand-off.`;
}
