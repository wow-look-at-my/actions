import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {ALREADY_RAN_ENV, GUARDED_NAME, findCheckRunViolations, findJobViolations, formatViolation, layerFailureRemedy, scanWorkflowYaml, shouldSkip} from './detect';

// The org's required merge check `all-builds` is a commit STATUS posted by
// the required-builds-manager app — not a workflow job.

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function run(): Promise<void> {
	// Same-job run-once: a clean pass earlier in this job exported the sentinel
	// (.g. the go-toolchain composite followed by buildhost-publish).
	if (shouldSkip(process.env[ALREADY_RAN_ENV])) {
		core.info('no-all-builds-job: guard already ran earlier in this job — skipping duplicate check');
		return;
	}

	const token = core.getInput('token');
	const octokit = token ? github.getOctokit(token) : undefined;
	if (!octokit) {
		core.warning('no token provided — the run-jobs and check-runs layers are skipped; the workflow-file scan still runs');
	}

	const messages: string[] = [];

	// Layers that cannot run are hard failures.
	let layerErrorCount = 0;

	let headSha = '';
	let runJobCount: number | undefined;
	if (octokit) {
		try {
			const {owner, repo} = github.context.repo;
			const runId = github.context.runId;
			const {data: runInfo} = await octokit.rest.actions.getWorkflowRun({owner, repo, run_id: runId});
			headSha = runInfo.head_sha;
			const runUrl = runInfo.html_url ?? '';
			const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {owner, repo, run_id: runId, per_page: 100, filter: 'latest'});
			runJobCount = jobs.length;
			for (const violation of findJobViolations(jobs)) {
				const subject = violation.workflowName ? `Job "${violation.jobName}" in workflow "${violation.workflowName}"` : `Job "${violation.jobName}" in this workflow run`;
				messages.push(formatViolation(subject, violation.url || runUrl));
			}
		} catch (error) {
			layerErrorCount++;
			core.error(`run-jobs layer failed (${errorMessage(error)}) — ${layerFailureRemedy(error, 'actions: read', "the run's jobs")}`);
		}
	}

	let checkRunCount: number | undefined;
	if (octokit) {
		try {
			const {owner, repo} = github.context.repo;
			const sha = headSha || github.context.sha;
			if (!sha) {
				throw new Error('no head SHA available');
			}
			const checkRuns = await octokit.paginate(octokit.rest.checks.listForRef, {owner, repo, ref: sha, per_page: 100});
			checkRunCount = checkRuns.length;
			for (const violation of findCheckRunViolations(checkRuns)) {
				const subject = violation.appSlug ? `Check run "${violation.name}" (posted by app "${violation.appSlug}")` : `Check run "${violation.name}"`;
				messages.push(formatViolation(subject, violation.url));
			}
		} catch (error) {
			layerErrorCount++;
			core.error(`check-runs layer failed (${errorMessage(error)}) — ${layerFailureRemedy(error, 'checks: read', "the head commit's check runs")}`);
		}
	}

	// Always runs; needs no token, only a checkout.
	let workflowFileCount: number | undefined;
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	const workflowsDir = path.join(workspace, '.github', 'workflows');
	let workflowFiles: string[] | undefined;
	try {
		workflowFiles = (await fsp.readdir(workflowsDir)).filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
	} catch (error) {
		if ((error as {code?: string}).code !== 'ENOENT') {
			throw error;
		}
		core.info(`${workflowsDir} does not exist (repo not checked out?) — workflow-file layer has nothing to scan`);
	}
	if (workflowFiles !== undefined) {
		workflowFileCount = workflowFiles.length;
		for (const name of workflowFiles) {
			const content = await fsp.readFile(path.join(workflowsDir, name), 'utf8');
			for (const violation of scanWorkflowYaml(`.github/workflows/${name}`, content)) {
				const subject = violation.via === 'key' ? `Job key "${violation.jobKey}" in workflow file "${violation.file}"` : `Job "${violation.jobKey}" in workflow file "${violation.file}"`;
				messages.push(formatViolation(subject));
			}
		}
	}

	if (messages.length === 0 && layerErrorCount === 0) {
		const scanned = [
			runJobCount === undefined ? 'run jobs skipped' : `${runJobCount} run job(s)`,
			checkRunCount === undefined ? 'check runs skipped' : `${checkRunCount} check run(s)`,
			workflowFileCount === undefined ? 'no workflow files' : `${workflowFileCount} workflow file(s)`
		];
		core.info(`OK — nothing named ${GUARDED_NAME} (${scanned.join(', ')})`);
		// Clean pass ONLY: mark the job so a later embed of this guard skips.
		core.exportVariable(ALREADY_RAN_ENV, '1');
		return;
	}

	for (const message of messages) {
		core.error(message);
	}
	if (messages.length > 0) {
		core.setFailed(`found ${messages.length} job(s)/check run(s)/workflow definition(s) named ${GUARDED_NAME} — a known trick to fake the org's required ${GUARDED_NAME} gate. The required check is owned by the required-builds-manager app; a job with that name only shadows it in the GitHub UI. Rename the offending job(s); do not try to work around this check.`);
	} else {
		core.setFailed(`${layerErrorCount} scanning layer(s) could not run — this guard fails when it cannot scan; each error above names what would fix it`);
	}
}

run().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
