import {execFileSync} from 'node:child_process';

// A container checkout belongs to another user, so git needs safe.directory to read it.
export function git(args: string[], input?: string): string {
	return execFileSync('git', ['-c', `safe.directory=${process.cwd()}`, ...args], {
		encoding: 'utf-8',
		input,
		// A large diff overflows the default buffer, and a failed diff lints the whole tree.
		maxBuffer: Infinity,
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
	});
}
