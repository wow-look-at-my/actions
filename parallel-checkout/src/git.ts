import {execFile} from 'child_process';

export type Run = {code: number; stdout: string; stderr: string};

// Pool bounds how many git processes run at once. Every git call takes a slot
// for exactly its own lifetime, and nothing holding a slot waits on another
// slot. The bound can never deadlock.
export class Pool {
	private active = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(private readonly size: number) {
		if (!Number.isInteger(size) || size < 1) {
			throw new Error(`jobs must be a positive integer, not ${size}`);
		}
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= this.size) {
			await new Promise<void>(resolve => this.waiting.push(resolve));
		}
		this.active += 1;
		try {
			return await task();
		} finally {
			this.active -= 1;
			const next = this.waiting.shift();
			if (next !== undefined) {
				next();
			}
		}
	}
}

export class Git {
	constructor(
		private readonly pool: Pool,
		// `-c` settings every call carries, such as the auth header.
		private readonly configArgs: string[],
		// Where a call with no repository runs.
		private readonly home?: string,
	) {}

	// run executes git and reports the exit code, so a caller that expects a
	// failure (a missing .gitmodules) can read it.
	run(args: string[], cwd?: string): Promise<Run> {
		return this.pool.run(
			() =>
				new Promise<Run>(resolve => {
					execFile(
						'git',
						[...this.configArgs, ...args],
						{
							cwd: cwd ?? this.home,
							maxBuffer: 1 << 30,
							env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
						},
						(error, stdout, stderr) => {
							const code = error === null ? 0 : typeof (error as {code?: unknown}).code === 'number' ? ((error as {code: number}).code) : 1;
							resolve({code, stdout: String(stdout), stderr: String(stderr)});
						},
					);
				}),
		);
	}

	// must executes git and fails loudly, with git's own words, on a nonzero exit.
	async must(args: string[], cwd?: string): Promise<string> {
		const result = await this.run(args, cwd);
		if (result.code !== 0) {
			throw new Error(`git ${args.join(' ')}${cwd === undefined ? '' : ` (in ${cwd})`} exited ${result.code}: ${result.stderr.trim()}`);
		}
		return result.stdout;
	}
}
