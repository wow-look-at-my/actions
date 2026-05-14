import { createInterface } from "node:readline";

const GITHUB_API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_HEAD_SHA = process.env.PR_HEAD_SHA;

if (!TOKEN || !REPO || !PR_NUMBER || !PR_HEAD_SHA) {
	process.stderr.write(
		"Missing required env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, PR_HEAD_SHA\n",
	);
	process.exit(1);
}

const [OWNER, REPO_NAME] = REPO.split("/");

async function ghFetch(method, path, body) {
	const res = await fetch(`${GITHUB_API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${res.status}: ${text}`);
	}
	return res.json();
}

const TOOLS = [
	{
		name: "get_pr_diff",
		description:
			"Get the unified diff of the pull request. Call this first to see what changed.",
		inputSchema: { type: "object", properties: {}, required: [] },
		async execute() {
			const res = await fetch(
				`${GITHUB_API}/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}`,
				{
					headers: {
						Authorization: `Bearer ${TOKEN}`,
						Accept: "application/vnd.github.diff",
						"X-GitHub-Api-Version": "2022-11-28",
					},
				},
			);
			if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
			return await res.text();
		},
	},
	{
		name: "add_review_comment",
		description:
			"Post a single inline review comment on a specific line of the PR diff. Call this immediately when you identify a finding. Prefix the body with the severity in bold: **blocker**, **concern**, or **nit**.",
		inputSchema: {
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
		async execute({ path, line, body }) {
			const comment = await ghFetch(
				"POST",
				`/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/comments`,
				{
					commit_id: PR_HEAD_SHA,
					path,
					line,
					body,
					side: "RIGHT",
				},
			);
			return `Posted comment on ${path}:${line}: ${comment.html_url}`;
		},
	},
	{
		name: "submit_review",
		description:
			"Submit the final PR review verdict. Call this exactly ONCE as your last action. Use APPROVE when there are no blockers (including when the PR is clean). Use REQUEST_CHANGES when at least one finding is a blocker. Use COMMENT for nits-only or neutral feedback.",
		inputSchema: {
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
		async execute({ event, body }) {
			const review = await ghFetch(
				"POST",
				`/repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`,
				{ event, body },
			);
			return `Submitted ${event} review: ${review.html_url}`;
		},
	},
];

const toolMap = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

function send(msg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

function handleMessage(msg) {
	const { id, method, params } = msg;

	if (method === "initialize") {
		send({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "pr-review", version: "1.0.0" },
			},
		});
		return;
	}

	if (method === "notifications/initialized") {
		return;
	}

	if (method === "tools/list") {
		send({
			jsonrpc: "2.0",
			id,
			result: {
				tools: TOOLS.map(({ name, description, inputSchema }) => ({
					name,
					description,
					inputSchema,
				})),
			},
		});
		return;
	}

	if (method === "tools/call") {
		const tool = toolMap[params?.name];
		if (!tool) {
			send({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{ type: "text", text: `Unknown tool: ${params?.name}` }],
					isError: true,
				},
			});
			return;
		}

		tool
			.execute(params?.arguments ?? {})
			.then((text) => {
				send({
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text }] },
				});
			})
			.catch((err) => {
				send({
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text: `Error: ${err.message}` }],
						isError: true,
					},
				});
			});
		return;
	}

	if (method === "ping") {
		send({ jsonrpc: "2.0", id, result: {} });
		return;
	}

	send({
		jsonrpc: "2.0",
		id,
		error: { code: -32601, message: `Method not found: ${method}` },
	});
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	try {
		handleMessage(JSON.parse(line));
	} catch (err) {
		process.stderr.write(`MCP parse error: ${err.message}\n`);
	}
});
