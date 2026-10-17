/**
 * pi extension that registers two tools for incremental PR review.
 *
 * Intentionally avoids importing from `@earendil-works/pi-coding-agent`,
 * `@earendil-works/pi-ai`, or `typebox`. shaftoe's bundled action embeds
 * those packages in a single file, so the names are not resolvable as
 * normal node modules from an external `.ts` extension. Using a plain
 * object factory and JSON Schema for `parameters` sidesteps that.
 *
 * Tools registered:
 *
 *   add_pr_comment(path, line, body, side?, start_line?, start_side?)
 *     Posts a single inline review comment immediately via
 *     POST /repos/{owner}/{repo}/pulls/{N}/comments. The agent calls this
 *     AS SOON AS each finding is identified, so it doesn't have to
 *     remember every finding to write a single big review at the end.
 *
 *   finish_review(event, body)
 *     Submits the final PR review with APPROVE / REQUEST_CHANGES /
 *     COMMENT and a short overall summary via POST /pulls/{N}/reviews.
 *     terminate: true so the agent stops cleanly after this call.
 *
 * Required env (set by the GitHub Actions runner):
 *   GITHUB_TOKEN       - workflow token with pull-requests: write
 *   GITHUB_REPOSITORY  - "owner/name"
 *   GITHUB_EVENT_PATH  - path to event payload JSON
 */

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

interface AddPrCommentArgs {
	path: string;
	line: number;
	body: string;
	side?: "LEFT" | "RIGHT";
	start_line?: number;
	start_side?: "LEFT" | "RIGHT";
}

interface FinishReviewArgs {
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
}

const addPrCommentTool = {
	name: "add_pr_comment",
	label: "Add PR Comment",
	description:
		"Post a single inline review comment on a specific line of the PR diff. Call this AS SOON AS you identify a finding - do not save findings until the end of the review.",
	promptSnippet:
		"Leave one inline review comment on a line in the PR diff. Use eagerly as findings are identified.",
	promptGuidelines: [
		"Use add_pr_comment immediately when you find a bug, concern, or nit - do not wait until the end of your analysis.",
		"For add_pr_comment, prefix the body with the severity in bold: **blocker**, **concern**, or **nit**.",
		"For add_pr_comment, `line` is the new-file line number (RIGHT side, default) or old-file line number (LEFT side). It must fall within a diff hunk.",
	],
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "Path to the file, relative to the repo root." },
			line: {
				type: "integer",
				description:
					"Line number in the diff. New-file line when side=RIGHT (default); old-file line when side=LEFT.",
			},
			body: {
				type: "string",
				description: "Comment body in GitHub markdown. Prefix with severity in bold.",
			},
			side: {
				type: "string",
				enum: ["LEFT", "RIGHT"],
				description: "Side of the diff. RIGHT (default) = new state; LEFT = previous state.",
			},
			start_line: {
				type: "integer",
				description:
					"For multi-line comments, the first line of the range. Omit for single-line.",
			},
			start_side: {
				type: "string",
				enum: ["LEFT", "RIGHT"],
				description: "Side for start_line. Required when start_line is set.",
			},
		},
		required: ["path", "line", "body"],
	},

	async execute(_toolCallId: string, params: AddPrCommentArgs) {
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
};

const finishReviewTool = {
	name: "finish_review",
	label: "Finish Review",
	description:
		"Submit the final PR review with a verdict (APPROVE / REQUEST_CHANGES / COMMENT) and a short overall summary. Call this ONCE as your last action after posting any inline comments via add_pr_comment.",
	promptSnippet:
		"Submit the final PR review verdict (approve / request_changes / comment) with a short overall summary.",
	promptGuidelines: [
		"Use finish_review as the very last action of the review. Do not write a text response after - the verdict is the review.",
		"For finish_review, the body is a short overall summary (one or two sentences). Per-line detail belongs in add_pr_comment, not here.",
		"For finish_review, choose APPROVE for ship-it, REQUEST_CHANGES if at least one finding is a blocker, COMMENT for nits-only or neutral feedback.",
	],
	parameters: {
		type: "object",
		properties: {
			event: {
				type: "string",
				enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
				description:
					"Review verdict. APPROVE = ship it. REQUEST_CHANGES = at least one blocker. COMMENT = nits / neutral.",
			},
			body: {
				type: "string",
				description: "Short overall summary in GitHub markdown.",
			},
		},
		required: ["event", "body"],
	},

	async execute(_toolCallId: string, params: FinishReviewArgs) {
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
};

export default function (pi: { registerTool: (tool: unknown) => void }) {
	pi.registerTool(addPrCommentTool);
	pi.registerTool(finishReviewTool);
}
