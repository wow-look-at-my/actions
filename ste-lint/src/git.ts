import {execFileSync} from 'node:child_process';

<<<<<<< HEAD
// A job container checks the repository out as another user. git then refuses
// the work tree as "dubious ownership" unless the call trusts it explicitly.
=======
// A container checkout belongs to another user, so git needs safe.directory to read it.
>>>>>>> origin/master
export function git(args: string[], input?: string): string {
	return execFileSync('git', ['-c', `safe.directory=${process.cwd()}`, ...args], {
		encoding: 'utf-8',
		input,
<<<<<<< HEAD
=======
		// A large diff overflows the default buffer, and a failed diff lints the whole tree.
>>>>>>> origin/master
		maxBuffer: Infinity,
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
	});
}
