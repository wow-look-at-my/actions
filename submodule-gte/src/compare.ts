// How a submodule's gitlink at HEAD stands against the one at the base ref.
export type Ancestry = 'same' | 'forward' | 'backward' | 'unrelated';

// One submodule's gitlink on each side. A side is absent when that side has no
// submodule at the path: the branch adds one, or removes one.
export type Entry = {
	path: string;
	base?: string;
	head?: string;
};

export type Verdict = {
	path: string;
	ok: boolean;
	message: string;
};

export function short(sha: string): string {
	return sha.slice(0, 12);
}

// A gitlink line of `git ls-tree -r <rev>`: mode 160000 names a commit of
// another repository. Every other mode is a file of this one.
export function gitlinks(lsTree: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const line of lsTree.split('\n')) {
		const match = /^160000 commit ([0-9a-f]{40})\t(.+)$/.exec(line);
		if (match !== null) {
			found.set(match[2], match[1]);
		}
	}
	return found;
}

// judge answers whether one submodule's move is allowed, given the ancestry
// that the submodule's own history reports. An absent ancestry means the
// question could not be answered.
//
// Forward is the move a build makes on its own, so it passes. Backward points
// the superproject at an older commit than the base branch already names, and
// every consumer of the merge then builds against code the base branch has
// moved past.
//
// Unrelated is the pair on separate lines of history, which a force-push over
// the submodule's branch produces. Nothing says the head carries what the base
// carries, so it fails with the backward case.
export function judge(entry: Entry, ancestry?: Ancestry): Verdict {
	const {path, base, head} = entry;
	if (base === undefined) {
		return {path, ok: true, message: `${path}: added at ${short(head as string)}`};
	}
	if (head === undefined) {
		return {path, ok: true, message: `${path}: removed, and it named ${short(base)}`};
	}
	if (base === head) {
		return {path, ok: true, message: `${path}: unmoved at ${short(base)}`};
	}
	if (ancestry === undefined) {
		return {
			path,
			ok: false,
			message: `${path}: ${short(base)} and ${short(head)} cannot be compared, so a move backwards would go unseen here`,
		};
	}
	if (ancestry === 'forward') {
		return {path, ok: true, message: `${path}: ${short(base)} -> ${short(head)}`};
	}
	if (ancestry === 'backward') {
		return {
			path,
			ok: false,
			message: `${path}: ${short(head)} is an ancestor of the base branch's ${short(base)}, so this moves the submodule backwards`,
		};
	}
	if (ancestry === 'unrelated') {
		return {
			path,
			ok: false,
			message: `${path}: ${short(head)} is on another line of history from the base branch's ${short(base)}, so it carries neither`,
		};
	}
	return {path, ok: true, message: `${path}: unmoved at ${short(base)}`};
}

// ancestryOf reads the two `merge-base --is-ancestor` answers a caller already
// asked git for. Each is true when the first named commit is an ancestor of the
// second.
export function ancestryOf(baseInHead: boolean, headInBase: boolean): Ancestry {
	if (baseInHead && headInBase) {
		return 'same';
	}
	if (baseInHead) {
		return 'forward';
	}
	if (headInBase) {
		return 'backward';
	}
	return 'unrelated';
}

// paths answers every submodule path either side holds, sorted, so one tree
// reports in one order.
export function paths(base: Map<string, string>, head: Map<string, string>): string[] {
	return [...new Set([...base.keys(), ...head.keys()])].sort();
}
