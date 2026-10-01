import {execFileSync} from 'node:child_process';

// A job container checks the repository out as another user. git then refuses
// the work tree as "dubious ownership" unless the call trusts it explicitly.
export function git(args: string[], input?: string): string {
	return execFileSync('git', ['-c', `safe.directory=${process.cwd()}`, ...args], {
		encoding: 'utf-8',
		input,
		maxBuffer: Infinity,
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
	});
}
