/** Key prefix shared with cache-upload / cache-download (pinned by tests). */
export const KEY_PREFIX = 'cache-xfer';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * REST list prefix: scoped to one hand-off name when given, otherwise the
 * whole cache-xfer namespace. The list API's `key` parameter is documented as
 * "An explicit key or prefix for identifying the cache".
 */
export function listPrefix(name?: string): string {
	return name ? `${KEY_PREFIX}-${name}-` : `${KEY_PREFIX}-`;
}

/**
 * Does `key` belong to run `runId` (any attempt)? Keys are
 * `cache-xfer-<name>-<runId>-<attempt>`; the dash before runId anchors the
 * match, so a runId can never match inside another run's longer id.
 */
export function isRunEntry(key: string, runId: string, name?: string): boolean {
	const nameSegment = name === undefined ? '.+' : escapeRegExp(name);
	return new RegExp(`^${KEY_PREFIX}-${nameSegment}-${escapeRegExp(runId)}-\\d+$`).test(key);
}

/** Parse a max-age like '12h', '90m', '2d'; '0' disables. Returns milliseconds. */
export function parseMaxAge(input: string): number {
	const trimmed = input.trim();
	if (trimmed === '0') {
		return 0;
	}
	const match = /^(\d+)([mhd])$/.exec(trimmed);
	if (!match) {
		throw new Error(`Invalid max-age '${input}': use <number>m|h|d (e.g. '12h'), or '0' to disable the sweep`);
	}
	const value = Number(match[1]);
	const unitMs = {m: 60_000, h: 3_600_000, d: 86_400_000}[match[2] as 'm' | 'h' | 'd'];
	return value * unitMs;
}

/**
 * Is the entry older than maxAge? Uses last_accessed_at (falling back to
 * created_at) from the REST response. Unknown timestamps are never swept.
 */
export function isAgedOut(lastAccessedAt: string | undefined, createdAt: string | undefined, nowMs: number, maxAgeMs: number): boolean {
	if (maxAgeMs <= 0) {
		return false;
	}
	const stamp = lastAccessedAt ?? createdAt;
	if (!stamp) {
		return false;
	}
	const t = Date.parse(stamp);
	if (Number.isNaN(t)) {
		return false;
	}
	return nowMs - t > maxAgeMs;
}
