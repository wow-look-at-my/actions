import * as YAML from 'yaml';

// The one name no workflow job may ever carry. The org's required merge check
// `all-builds` is a commit STATUS posted by the required-builds-manager app;
// a workflow job wearing the same name cannot satisfy that gate — it only
// shadows the app's status in the GitHub UI.
export const GUARDED_NAME = 'all-builds';

// GitHub App id of required-builds-manager — the only thing allowed to carry
// the all-builds name on a commit. Check runs posted by this app are exempt;
// everything else wearing the name is a violation.
export const REQUIRED_BUILDS_MANAGER_APP_ID = 3007670;

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
// exactly the guarded name. Handles the two decorations GitHub applies:
//   - a trailing matrix suffix:      `all-builds (ubuntu-latest)`
//   - reusable-workflow path parts:  `ci / all-builds`, `all-builds / deploy`
// Deliberately case-sensitive and exact per segment: `All-Builds` and
// `all-builds2` are different names and cannot shadow the gate's UI entry.
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
		// Only required-builds-manager itself is exempt. A missing/null app is
		// NOT excluded — an unattributed check run wearing the name is exactly
		// the kind of thing this guard exists to flag.
		if (checkRun.app?.id === REQUIRED_BUILDS_MANAGER_APP_ID) {
			continue;
		}
		violations.push({name: checkRun.name, appSlug: checkRun.app?.slug ?? '', url: checkRun.html_url ?? checkRun.details_url ?? ''});
	}
	return violations;
}

// Scans one workflow file's YAML for jobs named all-builds — by job KEY, or by
// a plain-string `name:` (an expression name like `${{ matrix.x }}` cannot be
// judged statically and is left to the API layers). Never throws: malformed or
// foreign YAML simply contributes no findings.
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
