import * as crypto from 'crypto';

// One cache key, shared by every action in this repo that derives a key from
// its own inputs. A key has two halves that do different jobs: `scheme` and
// `platform` and `label` are readable text, so a human reading the cache list
// can tell entries apart. The digest is what actually distinguishes them.
export interface CacheKeySpec {
	// Namespace and format version, e.g. `cached-run-v1`. Bump it to orphan
	// every existing entry when the meaning of a key changes.
	scheme: string;
	// Label segments that name the machine, e.g. `[runner.os, runner.arch]`.
	// An entry restored onto the wrong platform is garbage, so these are in the
	// digest too.
	platform: string[];
	// The caller's own discriminator. Readable in the key, and in the digest.
	label: string;
	// Everything else that changes what a hit MEANS. A field whose value the
	// action would act on differently belongs here.
	fields: Record<string, string | string[]>;
}

// A label a cache key can carry. GitHub rejects a comma outright, and a space
// or a slash survives but reads badly in the cache list.
export function sanitizeLabel(label: string): string {
	return label
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
}

// Splits on whitespace and commas, so a caller can write one entry per line, a
// single line, or a comma list. Sorted and deduplicated, so two orderings of
// one set share one entry.
export function normalizeList(input: string): string[] {
	const entries = input
		.split(/[\s,]+/)
		.map(entry => entry.trim())
		.filter(entry => entry !== '');
	return [...new Set(entries)].sort();
}

// Sorted keys, so the digest does not depend on the order a caller happened to
// build the object in.
function canonical(spec: CacheKeySpec): string {
	const fields: Record<string, string | string[]> = {};
	for (const name of Object.keys(spec.fields).sort()) {
		fields[name] = spec.fields[name];
	}
	return JSON.stringify({scheme: spec.scheme, platform: spec.platform, label: spec.label, fields});
}

export function computeDigest(spec: CacheKeySpec): string {
	return crypto.createHash('sha256').update(canonical(spec), 'utf8').digest('hex').slice(0, 40);
}

export interface CacheKey {
	key: string;
	digest: string;
}

export function buildKey(spec: CacheKeySpec): CacheKey {
	if (spec.scheme === '') {
		throw new Error('a cache key needs a scheme, which names the action and the key format version');
	}
	const digest = computeDigest(spec);
	const readable = [spec.scheme, ...spec.platform, spec.label]
		.map(segment => sanitizeLabel(segment))
		.filter(segment => segment !== '');
	return {key: `${readable.join('-')}-${digest}`, digest};
}
