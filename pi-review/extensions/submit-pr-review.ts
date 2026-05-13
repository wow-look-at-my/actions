/**
 * pi extension that registers two tools for incremental PR review:
 *
 *   1. `add_pr_comment(path, line, body, side?)`
 *      Posts a single inline review comment immediately. The agent is expected
 *      to call this as soon as a finding is identified rather than batching
 *      findings to the end of the conversation, where it would forget details.
 *
 *   2. `finish_review(event, body)`
 *      Submits the final PR review with a verdict (APPROVE / REQUEST_CHANGES /
 *      COMMENT) and an overall summary body. terminate: true so the agent
 *      stops after calling this.
 *
 * Required env (set by the GitHub Actions runner):
 *   GITHUB_TOKEN       - permission: pull-requests: write
 *   GITHUB_REPOSITORY  - "owner/name"
 *   GITHUB_EVENT_PATH  - path to event payload JSON
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import * as fs from "node:fs";

interface PullRequestContext {
	owner: string;
	repo: string;
	number: number;
	headSha: string;
}

let cachedContext: PullRequestContext | undefined;

function getPullRequestContext(): PullRequestContext {
	if (cachedContext) return cachedContext;

	const eventPath = process.env.GITHUB_EVENT_PATH;
	const repoEnv = process.env.GITHUB_REPOSITORY;
	if (!eventPath) {
		throw new Error("GITHUB_EVENT_PATH is not set; cannot resolve PR context.");
	}
	if (!repoEnv) {
		throw new Error("GITHUB_REPOSITORY env var is not set.");
	}

	const [owner, repo] = repoEnv.split("/");
	if (!owner || !repo) {
		throw new Error(`GITHUB_REPOSITORY="${repoEnv}" is not in owner/name format.`);
	}

	const payload = JSON.parse(fs.readFileSync(eventPath, "utf-8"));
	const pr = payload?.pull_request;
	if (!pr || typeof pr.number !== "number") {
		throw new Error(
			"No pull_request.number in GITHUB_EVENT_PATH payload; not running on a pull_request event.",
		);
	}
	const headSha = pr.head?.sha;
	if (typeof headSha !== "string") {
		throw new Error("No pull_request.head.sha in GITHUB_EVENT_PATH payload.");
	}

	cachedContext = { owner, repo, number: pr.number, headSha };
	return cachedContext;
}

async function ghApi<T>(
	method: "GET" | "POST" | "PUT" | "PATCH",
	path: string,
	body?: unknown,
): Promise<T> {
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error("GITHUB_TOKEN env var is not set.");

	const response = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`GitHub API ${response.status} ${response.statusText}: ${errorBody}`);
	}

	return (await response.json()) as T;
}

const addPrCommentTool = defineTool({
	name: "add_pr_comment",
	label: "Add PR Comment",
	description:
		"Post a single inline review comment on a specific line of the PR diff. Call this as soon as you identify a finding - do not save findings until the end of the review.",
	promptSnippet:
		"Leave one inline review comment on a line in the PR diff. Use eagerly as findings are identified.",
	promptGuidelines: [
		"Use add_pr_comment immediately when you find a bug, concern, or nit - do not wait until the end of your analysis.",
		"For add_pr_comment, prefix the body with the severity in bold: **blocker**, **concern**, or **nit**, then explain the issue.",
		"For add_pr_comment, `line` is the line number in the new file (RIGHT side) or old file (LEFT side). It must be part of the diff hunk.",
	],
	parameters: Type.Object({
		path: Type.String({ description: "Path to the file, relative to the repo root." }),
		line: Type.Integer({
			description:
				"Line number in the diff. New-file line number when side=RIGHT (default), old-file line number when side=LEFT.",
		}),
		body: Type.String({
			description: "Comment body in GitHub markdown. Prefix with severity in bold.",
		}),
		side: Type.Optional(
			StringEnum(["LEFT", "RIGHT"] as const, {
				description: "Side of the diff. RIGHT (default) = new state, LEFT = previous state.",
			}),
		),
		start_line: Type.Optional(
			Type.Integer({
				description:
					"For multi-line comments, the first line of the range. Omit for single-line.",
			}),
		),
		start_side: Type.Optional(
			StringEnum(["LEFT", "RIGHT"] as const, {
				description: "Side for start_line. Required when start_line is set.",
			}),
		),
	}),

	async execute(_toolCallId, params) {
		const ctx = getPullRequestContext();
		const payload: Record<string, unknown> = {
			commit_id: ctx.headSha,
			path: params.path,
			line: params.line,
			body: params.body,
			side: params.side ?? "RIGHT",
		};
		if (typeof params.start_line === "number") {
			payload.start_line = params.start_line;
			payload.start_side = params.start_side ?? payload.side;
		}

		const comment = await ghApi<{ id: number; html_url: string }>(
			"POST",
			`/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/comments`,
			payload,
		);

		return {
			content: [
				{
					type: "text",
					text: `Posted comment ${comment.id} on ${params.path}:${params.line}: ${comment.html_url}`,
				},
			],
			details: { comment_id: comment.id, path: params.path, line: params.line },
		};
	},
});

const finishReviewTool = defineTool({
	name: "finish_review",
	label: "Finish Review",
	description:
		"Submit the final PR review with a verdict (APPROVE / REQUEST_CHANGES / COMMENT) and an overall summary. Call this ONCE as your last action after you have posted any inline comments via add_pr_comment.",
	promptSnippet:
		"Submit the final PR review verdict (approve / request_changes / comment) with a short overall summary.",
	promptGuidelines: [
		"Use finish_review as the very last action of the review. Do not write a text response after - the verdict is the review.",
		"For finish_review, the body should be a short overall summary (one or two sentences). Per-line detail belongs in add_pr_comment, not here.",
		"For finish_review, choose APPROVE for ship-it, REQUEST_CHANGES if there is at least one blocker-level finding, COMMENT for nits-only or neutral feedback.",
	],
	parameters: Type.Object({
		event: StringEnum(["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const, {
			description:
				"Review verdict. APPROVE = ship it. REQUEST_CHANGES = at least one blocker. COMMENT = nits / neutral.",
		}),
		body: Type.String({
			description:
				"Short overall summary in GitHub markdown - one or two sentences. Detailed per-line findings go in add_pr_comment.",
		}),
	}),

	async execute(_toolCallId, params) {
		const ctx = getPullRequestContext();
		const review = await ghApi<{ id: number; html_url: string }>(
			"POST",
			`/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/reviews`,
			{ event: params.event, body: params.body },
		);

		return {
			content: [
				{
					type: "text",
					text: `Submitted review ${review.id} with event ${params.event}: ${review.html_url}`,
				},
			],
			details: { review_id: review.id, event: params.event },
			terminate: true,
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(addPrCommentTool);
	pi.registerTool(finishReviewTool);
}
