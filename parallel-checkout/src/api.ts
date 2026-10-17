import {Tree, ms} from './checkout';
import {Git} from './git';

type TreeEntry = {path: string; mode: string; type: string; sha: string};
type TreeBody = {tree: TreeEntry[]; truncated: boolean};

// treeFromApi reads the gitlinks out of a recursive trees-API answer. A
// truncated answer is no answer, because a gitlink past the cut would be missed.
export function treeFromApi(body: TreeBody, gitmodules: string): Tree | undefined {
	if (body.truncated) {
		return undefined;
	}
	const links = new Map<string, string>();
	for (const entry of body.tree) {
		if (entry.mode === '160000' && entry.type === 'commit') {
			links.set(entry.path, entry.sha);
		}
	}
	return {gitmodules, links};
}

export type ApiOptions = {
	git: Git;
	apiUrl: string;
	repository: string;
	token: string;
	url: string;
	ref: string;
	sha: string;
	log: (message: string) => void;
};

async function commitOf(opts: ApiOptions): Promise<string> {
	if (opts.sha !== '') {
		return opts.sha;
	}
	if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(opts.ref)) {
		return opts.ref;
	}
	const listing = await opts.git.must(['ls-remote', opts.url, opts.ref]);
	const line = listing.split('\n').find(entry => entry.endsWith(`\t${opts.ref}`));
	if (line === undefined) {
		throw new Error(`ls-remote did not list ${opts.ref}`);
	}
	return line.split('\t')[0];
}

async function ask(opts: ApiOptions, t0: number): Promise<Tree> {
	const sha = await commitOf(opts);
	const headers: Record<string, string> = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
	if (opts.token !== '') {
		headers.Authorization = `Bearer ${opts.token}`;
	}
	const base = `${opts.apiUrl}/repos/${opts.repository}`;
	const [treeRes, modulesRes] = await Promise.all([
		fetch(`${base}/git/trees/${sha}?recursive=1`, {headers}),
		fetch(`${base}/contents/.gitmodules?ref=${sha}`, {headers: {...headers, Accept: 'application/vnd.github.raw+json'}}),
	]);
	if (!treeRes.ok) {
		throw new Error(`trees API answered ${treeRes.status}`);
	}
	if (modulesRes.status === 404) {
		opts.log(`api: ${sha} has no .gitmodules (${ms(t0)})`);
		return {gitmodules: '', links: new Map()};
	}
	if (!modulesRes.ok) {
		throw new Error(`contents API answered ${modulesRes.status}`);
	}
	const tree = treeFromApi((await treeRes.json()) as TreeBody, await modulesRes.text());
	if (tree === undefined) {
		throw new Error('the tree is too large for one API answer');
	}
	opts.log(`api: ${tree.links.size} gitlink(s) at ${sha} read in ${ms(t0)}`);
	return tree;
}

// readTree asks the hosting API for the commit's submodules, so their fetches
// start while the superproject's own fetch is still in flight. Anything that
// stops it answers undefined, and the caller reads the fetched commit instead.
export async function readTree(opts: ApiOptions): Promise<Tree | undefined> {
	const t0 = Date.now();
	try {
		return await ask(opts, t0);
	} catch (error) {
		opts.log(`api: reading the tree early failed, so the submodules wait for the fetch: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

export type HeadOptions = {
	apiUrl: string;
	server: string;
	token: string;
	log: (message: string) => void;
};

type Ask = {owner: string; name: string; refs: string[]; done: (listing: string | undefined) => void};

// headLister answers what `git ls-remote --symref URL HEAD REFS...` answers,
// for every repository on the server, in one GraphQL request per batch. The
// calls made in one turn of the event loop share the batch. A repository the
// API does not answer gets undefined, and the caller asks git instead.
export function headLister(opts: HeadOptions): (url: string, refs: string[]) => Promise<string | undefined> {
	let batch: Ask[] = [];
	const flush = async () => {
		const asks = batch;
		batch = [];
		const t0 = Date.now();
		const fields = asks.map((ask, i) => {
			const refs = ask.refs.map((ref, j) => `h${j}: ref(qualifiedName: ${JSON.stringify(ref)}) { target { oid } }`).join(' ');
			return `r${i}: repository(owner: ${JSON.stringify(ask.owner)}, name: ${JSON.stringify(ask.name)}) { defaultBranchRef { name target { oid } } ${refs} }`;
		});
		type Ref = {target: {oid: string}} | null;
		type Answer = {data?: Record<string, ({defaultBranchRef: {name: string; target: {oid: string}} | null} & Record<string, Ref>) | null>};
		let answer: Answer;
		try {
			const res = await fetch(`${opts.apiUrl}/graphql`, {
				method: 'POST',
				headers: {Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json'},
				body: JSON.stringify({query: `query { ${fields.join(' ')} }`}),
			});
			if (!res.ok) {
				throw new Error(`the GraphQL API answered ${res.status}`);
			}
			answer = (await res.json()) as Answer;
		} catch (error) {
			opts.log(`api: the branch heads of ${asks.length} repositor${asks.length === 1 ? 'y' : 'ies'} were not read, so git lists them: ${error instanceof Error ? error.message : String(error)}`);
			asks.forEach(ask => ask.done(undefined));
			return;
		}
		asks.forEach((ask, i) => {
			const repo = answer.data?.[`r${i}`];
			if (repo === null || repo === undefined) {
				ask.done(undefined);
				return;
			}
			const lines: string[] = [];
			if (repo.defaultBranchRef !== null) {
				lines.push(`ref: refs/heads/${repo.defaultBranchRef.name}\tHEAD`, `${repo.defaultBranchRef.target.oid}\tHEAD`);
			}
			ask.refs.forEach((ref, j) => {
				const found = repo[`h${j}`] as Ref;
				if (found !== null && found !== undefined) {
					lines.push(`${found.target.oid}\t${ref}`);
				}
			});
			ask.done(`${lines.join('\n')}\n`);
		});
		opts.log(`api: the branch heads of ${asks.length} repositor${asks.length === 1 ? 'y' : 'ies'} read in ${ms(t0)}`);
	};
	return (url, refs) => {
		const prefix = `${opts.server}/`;
		const match = url.startsWith(prefix) ? /^([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.slice(prefix.length)) : null;
		if (opts.token === '' || match === null) {
			return Promise.resolve(undefined);
		}
		return new Promise(done => {
			if (batch.length === 0) {
				setImmediate(() => void flush());
			}
			batch.push({owner: match[1], name: match[2], refs, done});
		});
	};
}
