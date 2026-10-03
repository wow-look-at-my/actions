import * as YAML from 'yaml';

// The name no workflow job may ever carry.
export const GUARDED_NAME = 'all-builds';

// GitHub App id of required-builds-manager — the only thing allowed to carry the all-builds name on a commit.
export const REQUIRED_BUILDS_MANAGER_APP_ID = 3007670;

// Same-job run-once sentinel.
export const ALREADY_RAN_ENV = 'NO_ALL_BUILDS_JOB_ALREADY_RAN';

// True when the sentinel says the guard already completed a clean pass
// earlier in this job.
export function shouldSkip(value: string | undefined): boolean {
	return value !== undefined && value !== '';
}

export interface JobLike {
	name: string;
	workflow_name?: string | null;
	html_url?: string | null;
}

export interface JobViolation {
	jobName: string;
	workflowName: string;
	url: string;
}

export interface CheckRunLike {
	name: string;
	app?: {id?: number; slug?: string | null} | null;
	html_url?: string | null;
	details_url?: string | null;
}

export interface CheckRunViolation {
	name: string;
	appSlug: string;
	url: string;
}

export interface WorkflowFileViolation {
	file: string;
	jobKey: string;
	via: 'key' | 'name';
}

// True when a rendered job/check-run name is (or contains as a path segment)
// exactly the guarded name.
export function isShadowJobName(name: string): boolean {
	let candidate = name.trim();
	if (candidate.endsWith(')')) {
		const suffixStart = candidate.lastIndexOf(' (');
		if (suffixStart !== -1) {
			candidate = candidate.slice(0, suffixStart);
		}
	}
	return candidate.split(' / ').some(segment => segment === GUARDED_NAME);
}

export function findJobViolations(jobs: JobLike[]): JobViolation[] {
	const violations: JobViolation[] = [];
	for (const job of jobs) {
		if (isShadowJobName(job.name)) {
			violations.push({jobName: job.name, workflowName: job.workflow_name ?? '', url: job.html_url ?? ''});
		}
	}
	return violations;
}

export function findCheckRunViolations(checkRuns: CheckRunLike[]): CheckRunViolation[] {
	const violations: CheckRunViolation[] = [];
	for (const checkRun of checkRuns) {
		if (!isShadowJobName(checkRun.name)) {
			continue;
		}
		// Only required-builds-manager itself is exempt.
		if (checkRun.app?.id === REQUIRED_BUILDS_MANAGER_APP_ID) {
			continue;
		}
		violations.push({name: checkRun.name, appSlug: checkRun.app?.slug ?? '', url: checkRun.html_url ?? checkRun.details_url ?? ''});
	}
	return violations;
}

// Scans one workflow file's YAML for jobs named all-builds — by job KEY, or
// by a plain-string `name:` (an expression name like `${{ matrix.x }}` cannot
// be judged statically and is left to the API layers). Never throws:
// malformed or foreign YAML contributes no findings.
export function scanWorkflowYaml(file: string, content: string): WorkflowFileViolation[] {
	let parsed: unknown;
	try {
		parsed = YAML.parse(content);
	} catch {
		return [];
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return [];
	}
	const jobs = (parsed as Record<string, unknown>).jobs;
	if (typeof jobs !== 'object' || jobs === null || Array.isArray(jobs)) {
		return [];
	}
	const violations: WorkflowFileViolation[] = [];
	for (const [jobKey, job] of Object.entries(jobs as Record<string, unknown>)) {
		if (jobKey === GUARDED_NAME) {
			violations.push({file, jobKey, via: 'key'});
			continue;
		}
		if (typeof job !== 'object' || job === null || Array.isArray(job)) {
			continue;
		}
		const name = (job as Record<string, unknown>).name;
		if (typeof name === 'string' && !name.includes('${{') && isShadowJobName(name)) {
			violations.push({file, jobKey, via: 'name'});
		}
	}
	return violations;
}

// What to tell the reader when a scanning layer could not run.
export function layerFailureRemedy(error: unknown, grant: string, subject: string): string {
	const status = typeof error === 'object' && error !== null ? (error as {status?: unknown}).status : undefined;
	if (status === 401 || status === 403) {
		return `grant '${grant}' to let this guard scan ${subject}`;
	}
	return `not an authorization failure — widening the token fixes nothing; re-run once the API answers again`;
}

// The per-finding message. The blunt wording is operator-mandated — do not
// soften it: name the job, state that the name is a known deception attempt,
// that it does not satisfy the gate (the required check is the
// required-builds-manager app's status; the app owns all-builds aggregation),
// that it only shadows the real gate in the GitHub UI, and that the fix is to
// RENAME the job — not to work around this check.
export function formatViolation(subject: string, url?: string): string {
	const message =
		`${subject} is named ${GUARDED_NAME}. ` +
		`Naming a job ${GUARDED_NAME} is a known deception attempt: it does not satisfy the org's required ${GUARDED_NAME} gate ` +
		`(that check is the required-builds-manager app's status — the app owns ${GUARDED_NAME} aggregation); ` +
		`it only shadows the real gate in the GitHub UI. Rename the job; do not try to work around this check.`;
	return url ? `${message} ${url}` : message;
}
