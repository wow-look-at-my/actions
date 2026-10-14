// A run lock holds one value per name for one attempt of one workflow run.
// The first job to ask for a name records its value. Every later job of the
// attempt gets that same value back.

export type RunLockId = {repository: string; runId: string; runAttempt: string};

export type Fetch = (url: string, init: {method: string; headers: Record<string, string>; body?: string}) => Promise<{status: number; text(): Promise<string>}>;

export type RunLockOptions = {
	// The store's base URL, which is also the audience of the OIDC token.
	store: string;
	run: RunLockId;
	token: (audience: string) => Promise<string>;
	fetch: Fetch;
	log: (message: string) => void;
	retryMs?: number;
};

type Answer = {found?: boolean; value?: string};

// lockName is the name a followed submodule's head is locked under. go-toolchain's pipeline locks its fork checkout under the same name.
export function lockName(url: string, branch: string): string {
	const path = url.replace(/^[a-z+]+:\/\//, '').replace(/\.git$/, '');
	return `${path}@${branch}`;
}

// runLock returns a function that gives back the value the store holds for
// name in this run attempt, and records head as that value when it holds none.
export function runLock(opts: RunLockOptions): (name: string, head: string) => Promise<string> {
	const base = opts.store.replace(/\/+$/, '');
	const retryMs = opts.retryMs ?? 2000;

	// call sends a request until the store answers. A transport failure or a 5xx or 429 answer is tried again on a fixed cadence.
	async function call(method: string, url: string, body?: string): Promise<Answer> {
		for (;;) {
			let response: {status: number; text: string};
			try {
				const headers: Record<string, string> = {Authorization: `Bearer ${await opts.token(base)}`};
				if (body !== undefined) {
					headers['Content-Type'] = 'application/json';
				}
				const reply = await opts.fetch(url, {method, headers, body});
				response = {status: reply.status, text: await reply.text()};
			} catch (error) {
				opts.log(`run lock: ${method} ${url}: ${error instanceof Error ? error.message : String(error)}; trying again in ${retryMs / 1000}s`);
				await new Promise(resolve => setTimeout(resolve, retryMs));
				continue;
			}
			if (response.status === 200) {
				return JSON.parse(response.text) as Answer;
			}
			const failure = `${method} ${url}: HTTP ${response.status}: ${response.text.trim()}`;
			if (response.status < 500 && response.status !== 429) {
				throw new Error(`run lock: ${failure}`);
			}
			opts.log(`run lock: ${failure}; trying again in ${retryMs / 1000}s`);
			await new Promise(resolve => setTimeout(resolve, retryMs));
		}
	}

	return async (name: string, head: string): Promise<string> => {
		const query = new URLSearchParams({repository: opts.run.repository, run_id: opts.run.runId, run_attempt: opts.run.runAttempt, name});
		let answer = await call('GET', `${base}/api/v1/run-locks?${query}`);
		if (answer.found !== true) {
			const body = JSON.stringify({repository: opts.run.repository, run_id: opts.run.runId, run_attempt: opts.run.runAttempt, name, value: head});
			answer = await call('POST', `${base}/api/v1/run-locks`, body);
		}
		if (typeof answer.value !== 'string' || answer.value === '') {
			throw new Error(`run lock ${name}: the store holds no value`);
		}
		return answer.value;
	};
}
