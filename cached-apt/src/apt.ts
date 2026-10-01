import {buildKey, CacheKey, normalizeList, sanitizeLabel} from '../../_shared/cache-key/lib';

export const CACHE_VERSION = 'cached-apt-v1';

export interface KeyParts {
	packages: string[];
	osId: string;
	osVersion: string;
	arch: string;
	extraKey: string;
}

export interface Member {
	// Path relative to `/`, which is what tar stores and what `-C /` restores.
	relative: string;
	absolute: string;
}

export interface Stats {
	isDirectory(): boolean;
}

export const normalizePackages = normalizeList;

// A package name apt accepts, optionally arch-qualified and optionally pinned
// to a version. Anything else is a typo or an injected argument. A pin reaches
// `apt-get install` only: the file list comes from the names dpkg reports.
export function validatePackageName(name: string): void {
	if (!/^[a-z0-9][a-z0-9+._-]*(?::[a-z0-9-]+)?(?:=[A-Za-z0-9.+~:-]+)?$/.test(name)) {
		throw new Error(`not a valid apt package name: ${JSON.stringify(name)}`);
	}
}

export {sanitizeLabel};

// The digest covers everything that changes which files an install produces. It
// deliberately excludes apt sources and `apt-get update` state: those move on
// their own and would miss the cache on every run.
function spec(parts: KeyParts): Parameters<typeof buildKey>[0] {
	return {
		scheme: CACHE_VERSION,
		platform: [parts.osId, parts.osVersion, parts.arch],
		label: parts.extraKey,
		fields: {packages: parts.packages}
	};
}

export function cacheKey(parts: KeyParts): CacheKey {
	return buildKey(spec(parts));
}

export function computeDigest(parts: KeyParts): string {
	return cacheKey(parts).digest;
}

export function computeCacheKey(parts: KeyParts): string {
	return cacheKey(parts).key;
}

// Only `ii` means the files are on disk: a removed package stays listed at
// `rc`. The status field is padded to three columns, so it needs a trim.
export function parseInstalledSet(stdout: string): Set<string> {
	const installed = new Set<string>();
	for (const line of stdout.split('\n')) {
		const [status, name] = line.split('\t');
		if (name !== undefined && status.trim() === 'ii' && name.trim() !== '') {
			installed.add(name.trim());
		}
	}
	return installed;
}

export function diffInstalled(before: Set<string>, after: Set<string>): string[] {
	return [...after].filter(name => !before.has(name)).sort();
}

// `dpkg-query -L` prints one absolute path per line, plus diversion notes that
// start with a word rather than a slash. `/.` names the root itself.
export function parseDpkgFileList(stdout: string): string[] {
	const paths: string[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.startsWith('/') || line === '/.' || line === '/') {
			continue;
		}
		paths.push(line);
	}
	return [...new Set(paths)].sort();
}

export interface MemberSelection {
	members: Member[];
	skippedDirectories: number;
	skippedMissing: string[];
}

// Keeps files and symlinks, drops directories. A directory listed by dpkg
// usually predates the package, and archiving it would restore its mode over
// whatever the runner already has there.
export function selectMembers(paths: string[], lstat: (target: string) => Stats | undefined): MemberSelection {
	const members: Member[] = [];
	const skippedMissing: string[] = [];
	let skippedDirectories = 0;

	for (const absolute of paths) {
		const stats = lstat(absolute);
		if (stats === undefined) {
			skippedMissing.push(absolute);
			continue;
		}
		if (stats.isDirectory()) {
			skippedDirectories++;
			continue;
		}
		members.push({absolute, relative: absolute.replace(/^\/+/, '')});
	}

	return {members, skippedDirectories, skippedMissing};
}

// NUL separation, because tar reads `-T` line by line and a name may hold a
// space, a quote or a leading dash. GNU tar takes names literally under --null.
export function encodeFileList(members: Member[]): Buffer {
	return Buffer.from(members.map(member => `${member.relative}\0`).join(''), 'utf8');
}

export interface Manifest {
	version: string;
	key: string;
	packages: string[];
	installed: string[];
	fileCount: number;
}

export function parseOsRelease(content: string): {id: string; versionId: string} {
	const fields = new Map<string, string>();
	for (const line of content.split('\n')) {
		const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
		if (match) {
			fields.set(match[1], match[2].replace(/^"(.*)"$/, '$1'));
		}
	}
	const id = fields.get('ID') ?? '';
	const versionId = fields.get('VERSION_ID') ?? '';
	if (id === '' || versionId === '') {
		throw new Error('/etc/os-release has no ID or VERSION_ID, so the cache key cannot name this distribution');
	}
	return {id, versionId};
}
