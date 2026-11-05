const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_HEAD_SHA = process.env.PR_HEAD_SHA;

const [OWNER, REPO_NAME] = REPO!.split("/");

async function ghFetch(
	method: string,
	path: string,
	body?: unknown,
	accept?: string,
): Promise<unknown> {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: accept || "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${res.status}: ${text}`);
	}
	return accept?.includes("diff") ? res.text() : res.json();
}

export default function (pi: { registerTool: (tool: unknown) => void }) {
	pi.registerTool({
		name: "get_pr_diff",
		label: "Get PR Diff",
		description:
			"Get the unified diff of the pull request. Call this first to see what changed.",
		parameters: { type: "object", properties: {}, required: [] },
		async execute() {
			const diff = await ghFetch(
				"GET",
				`/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}`,
				undefined,
				"application/vnd.github.diff",
			);
			return { content: [{ type: "text", text: diff }], details: {} };
		},
	});

	pi.registerTool({
		name: "add_review_comment",
		label: "Add Review Comment",
		description:
			"Post a single inline review comment on a specific line of the PR diff. Call this immediately when you identify a finding. Prefix the body with the severity in bold: **blocker**, **concern**, or **nit**.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "File path relative to the repo root.",
				},
				line: {
					type: "integer",
					description:
						"Line number in the new file (RIGHT side of the diff). Must fall within a diff hunk.",
				},
				body: {
					type: "string",
					description:
						"Comment body in GitHub markdown. Prefix with severity: **blocker**, **concern**, or **nit**.",
				},
			},
			required: ["path", "line", "body"],
		},
		async execute(
			_toolCallId: string,
			params: { path: string; line: number; body: string },
		) {
			const comment: any = await ghFetch(
				"POST",
				`/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/comments`,
				{
					commit_id: PR_HEAD_SHA,
					path: params.path,
					line: params.line,
					body: params.body,
					side: "RIGHT",
				},
			);
			return {
				content: [
					{
						type: "text",
						text: `Posted comment on ${params.path}:${params.line}: ${comment.html_url}`,
					},
				],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "submit_review",
		label: "Submit Review",
		description:
			"Submit the final PR review verdict. Call this exactly ONCE as your last action. Use APPROVE when there are no blockers. Use REQUEST_CHANGES when at least one finding is a blocker. Use COMMENT for nits-only or neutral feedback.",
		parameters: {
			type: "object",
			properties: {
				event: {
					type: "string",
					enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
					description:
						"Review verdict. APPROVE = ship it. REQUEST_CHANGES = has blockers. COMMENT = nits only.",
				},
				body: {
					type: "string",
					description: "Short overall summary (one or two sentences).",
				},
			},
			required: ["event", "body"],
		},
		async execute(
			_toolCallId: string,
			params: { event: string; body: string },
		) {
			const review: any = await ghFetch(
				"POST",
				`/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`,
				{ event: params.event, body: params.body },
			);
			return {
				content: [
					{
						type: "text",
						text: `Submitted ${params.event} review: ${review.html_url}`,
					},
				],
				details: {},
				terminate: true,
			};
		},
	});
}
