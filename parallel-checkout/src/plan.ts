// Pure planning: what to fetch, where to put it, and how the submodule tree reads out of a fetched commit.

export type Submodule = {name: string; path: string; url: string};

// parseGitmodules reads the sections of a .gitmodules file. Keys git does not
// use for cloning (branch, update, ignore) pass through unread.
export function parseGitmodules(text: string): Submodule[] {
	const out: Submodule[] = [];
	let current: {name: string; path?: string; url?: string} | undefined;
	const flush = () => {
		if (current === undefined) {
			return;
		}
		if (current.path === undefined || current.url === undefined) {
			throw new Error(`.gitmodules: submodule "${current.name}" has no ${current.path === undefined ? 'path' : 'url'}`);
		}
		out.push({name: current.name, path: current.path, url: current.url});
		current = undefined;
	};
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#') || line.startsWith(';')) {
			continue;
		}
		const section = /^\[submodule\s+"((?:[^"\\]|\\.)*)"\]$/.exec(line);
		if (section !== null) {
			flush();
			current = {name: section[1].replace(/\\(.)/g, '$1')};
			continue;
		}
		if (/^\[/.test(line)) {
			flush();
			continue;
		}
		if (current === undefined) {
			continue;
		}
		const eq = line.indexOf('=');
		if (eq < 0) {
			continue;
		}
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (key === 'path') {
			current.path = value;
		} else if (key === 'url') {
			current.url = value;
		}
	}
	flush();
	return out;
}

// gitlinks picks the submodule commits out of `git ls-tree -r` output.
export function gitlinks(lsTree: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of lsTree.split('\n')) {
		const match = /^160000 commit ([0-9a-f]{40,64})\t(.+)$/.exec(line);
		if (match !== null) {
			out.set(match[2], match[1]);
		}
	}
	return out;
}

// resolveUrl turns a relative submodule url into one the transport can open,
// the way git's own `submodule--helper` does. Each `../` drops one path
// component of the superproject's remote, and `./` drops nothing.
export function resolveUrl(url: string, remote: string): string {
	if (!url.startsWith('./') && !url.startsWith('../')) {
		return url;
	}
	let base = remote.replace(/\/+$/, '');
	let rest = url;
	while (rest.startsWith('../') || rest.startsWith('./')) {
		if (rest.startsWith('../')) {
			rest = rest.slice(3);
			base = dropComponent(base);
		} else {
			rest = rest.slice(2);
		}
	}
	return rest === '' ? base : `${base}/${rest}`;
}

function dropComponent(base: string): string {
	const scheme = base.indexOf('://');
	const hostEnd = scheme >= 0 ? base.indexOf('/', scheme + 3) : -1;
	const slash = base.lastIndexOf('/');
	// The host itself is not a component, so a URL stops dropping at its first slash.
	if (slash >= 0 && (scheme < 0 || (hostEnd >= 0 && slash >= hostEnd))) {
		return base.slice(0, slash);
	}
	// An scp-like `host:org/repo` bottoms out at `host:`.
	const colon = base.indexOf(':');
	if (scheme < 0 && colon >= 0) {
		return base.slice(0, colon + 1);
	}
	throw new Error(`cannot resolve a relative submodule url above ${base}`);
}

export type RefPlan = {
	// The refspec the fetch takes, so the commit lands under a name.
	refspec: string;
	// A local branch to create at the target, when the ref is a branch.
	branch?: string;
	// What the checkout targets.
	target: string;
};

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

// planRef decides how a ref string reaches the worktree. A branch gets a local
// branch tracking origin; a tag, a pull ref or a bare commit checks out detached.
export function planRef(ref: string, sha: string): RefPlan {
	if (ref === '' && sha === '') {
		throw new Error('no ref to check out: GITHUB_REF and GITHUB_SHA are both empty and no ref input was given');
	}
	const want = sha !== '' ? sha : ref;
	if (ref.startsWith('refs/heads/')) {
		const branch = ref.slice('refs/heads/'.length);
		return {refspec: `+${want}:refs/remotes/origin/${branch}`, branch, target: `refs/remotes/origin/${branch}`};
	}
	if (ref.startsWith('refs/pull/')) {
		const local = `refs/remotes/${ref.slice('refs/'.length)}`;
		return {refspec: `+${want}:${local}`, target: local};
	}
	if (ref.startsWith('refs/')) {
		return {refspec: `+${want}:${ref}`, target: ref};
	}
	if (ref === '' && SHA.test(sha)) {
		return {refspec: `+${sha}:refs/remotes/origin/detached`, target: sha};
	}
	if (SHA.test(ref)) {
		return {refspec: `+${ref}:refs/remotes/origin/detached`, target: ref};
	}
	// A bare name: the caller resolves it with ls-remote before planning again.
	throw new Error(`ref "${ref}" is neither a full ref nor a commit; resolve it first`);
}

// pickRef answers which full ref a bare name means, from `git ls-remote` output.
export function pickRef(name: string, lsRemote: string): string {
	const found = new Set<string>();
	for (const line of lsRemote.split('\n')) {
		const parts = line.split('\t');
		if (parts.length === 2) {
			found.add(parts[1]);
		}
	}
	for (const candidate of [`refs/heads/${name}`, `refs/tags/${name}`]) {
		if (found.has(candidate)) {
			return candidate;
		}
	}
	throw new Error(`ref "${name}" is not a branch or a tag on the remote`);
}

// gitdirFor is where the superproject keeps a submodule's repository.
export function gitdirFor(superGitdir: string, name: string): string {
	if (name.split('/').some(part => part === '..' || part === '')) {
		throw new Error(`.gitmodules: submodule name "${name}" would escape the modules directory`);
	}
	return `${superGitdir}/modules/${name}`;
}

export function basicAuth(token: string): string {
	return Buffer.from(`x-access-token:${token}`).toString('base64');
}
