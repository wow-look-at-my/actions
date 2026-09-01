import {parse} from 'yaml';

export type Level = 'none' | 'read' | 'write';

export type Source = 'job' | 'workflow' | 'default';

export interface Resolution {
	granted: boolean;
	level: Level;
	source: Source;
}

const RANK: Record<Level, number> = {none: 0, read: 1, write: 2};

export function isLevel(value: unknown): value is Level {
	return value === 'none' || value === 'read' || value === 'write';
}

// A block that exists but omits the permission grants it nothing: GitHub drops
// every scope the block leaves out.
function levelIn(block: unknown, permission: string, where: string): Level | undefined {
	if (block === undefined || block === null) {
		return undefined;
	}
	if (typeof block === 'string') {
		if (block === 'write-all') {
			return 'write';
		}
		if (block === 'read-all') {
			return 'read';
		}
		throw new Error(`${where} permissions is '${block}', which is neither read-all nor write-all`);
	}
	if (typeof block !== 'object') {
		throw new Error(`${where} permissions is a ${typeof block}, not a mapping`);
	}
	const scopes = block as Record<string, unknown>;
	if (!(permission in scopes)) {
		return 'none';
	}
	const level = scopes[permission];
	if (!isLevel(level)) {
		throw new Error(`${where} permissions.${permission} is '${String(level)}', not read, write or none`);
	}
	return level;
}

// The job block replaces the workflow block outright. GitHub does not merge the
// two, so a job block that omits a scope drops it however the workflow set it.
export function resolve(content: string, jobId: string, permission: string, required: Level): Resolution {
	const doc = parse(content) as Record<string, unknown> | null;
	if (doc === null || typeof doc !== 'object') {
		throw new Error('the workflow file parsed to no mapping');
	}

	const jobs = doc.jobs;
	if (jobs === undefined || jobs === null || typeof jobs !== 'object') {
		throw new Error('the workflow file names no jobs');
	}
	const job = (jobs as Record<string, unknown>)[jobId];
	if (job === undefined) {
		const names = Object.keys(jobs as Record<string, unknown>).join(', ');
		throw new Error(`the workflow file names no job '${jobId}'. It has: ${names}`);
	}
	if (job === null || typeof job !== 'object') {
		throw new Error(`job '${jobId}' is not a mapping`);
	}

	const fromJob = levelIn((job as Record<string, unknown>).permissions, permission, `job '${jobId}'`);
	const level = fromJob ?? levelIn(doc.permissions, permission, 'workflow');
	const source: Source = fromJob !== undefined ? 'job' : level !== undefined ? 'workflow' : 'default';

	return {
		granted: RANK[level ?? 'none'] >= RANK[required],
		level: level ?? 'none',
		source,
	};
}
