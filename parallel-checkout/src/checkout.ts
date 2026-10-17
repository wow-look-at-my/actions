import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {Git} from './git';
import {Head, RefPlan, SHA, followed, gitdirFor, gitlinks, parseGitmodules, pickHead, resolveUrl} from './plan';

export type Submodules = 'false' | 'true' | 'recursive';

// Tree is what a commit says about its submodules: the .gitmodules text and the gitlink at each path.
export type Tree = {gitmodules: string; links: Map<string, string>};

export type Options = {
	git: Git;
	// The superproject's worktree, absolute.
	dir: string;
	url: string;
	plan: RefPlan;
	depth: number;
	submodules: Submodules;
	// Threads git spends writing files, per checkout.
	workers: number;
	// Local config written into every repository once its checkout is done, such as a persisted credential.
	config: Array<[string, string]>;
	// A way to read the superproject's tree without waiting for its fetch, such as the hosting API.
	rootTree?: () => Promise<Tree | undefined>;
	// Direct submodules whose url starts with a scope prefix take the head of `branch` on their remote instead of the gitlink.
	follow?: {branch: string; scope: string[]};
	// lockHead gives back the commit this run locked for a followed submodule, and locks head when the run has none.
	lockHead?: (url: string, branch: string, head: string) => Promise<string>;
	// A directory of bare repositories, one per url. Every fetch lands there, and a commit already there needs no fetch.
	store?: string;
	log: (message: string) => void;
};

export type Result = {commit: string; repos: number};

type Repo = {
	dir: string;
	// The repository directory; a submodule's lives under its parent's modules/.
	gitdir: string;
	url: string;
	// What to fetch, and what to put in the worktree.
	refspec: string;
	target: string;
	branch?: string;
	// How far below this repo submodules are still taken.
	submodules: Submodules;
	// The store repository that holds this repository's objects, once the store answered.
	objects?: string;
	// The submodule paths of this repository's tree, once the tree is read.
	links?: string[];
	// True when a stored worktree moved into place, so git writes no files here.
	placed?: boolean;
	// A label for the log.
	label: string;
};

export function ms(since: number): string {
	return `${Date.now() - since}ms`;
}

// Checkout walks a repository and its submodule tree. Every repository is
// fetched as soon as its commit is known. Every worktree is written as soon as
// its fetch lands and its submodule directories exist. Nothing waits on a
// sibling or on a parent's worktree.
export class Checkout {
	private repos = 0;
	// Every repository this checkout wrote, so the config that lands after the tree is in place covers all of them.
	private readonly written: Repo[] = [];
	// Commands that write one repository's config are serialized, because git gives up on a held lock instead of waiting.
	private readonly configLocks = new Map<string, Promise<void>>();
	// Fetches into one store repository run one at a time, because a shallow fetch holds a lock git does not wait on.
	private readonly storeLocks = new Map<string, Promise<unknown>>();
	private templated?: Promise<{config: string; head: string}>;
	// The store repositories this run fetched into, which compact rewrites.
	private readonly fetchedStores = new Set<string>();

	constructor(private readonly opts: Options) {}

	async run(): Promise<Result> {
		const root: Repo = {
			dir: this.opts.dir,
			gitdir: path.join(this.opts.dir, '.git'),
			url: this.opts.url,
			refspec: this.opts.plan.refspec,
			target: this.opts.plan.target,
			branch: this.opts.plan.branch,
			submodules: this.opts.submodules,
			label: this.opts.url,
		};
		const commit = await this.take(root, this.opts.rootTree);
		// The per-repo config lands once the tree is in place, one writer at a time per repository.
		await Promise.all(this.written.map(repo => this.configure(repo, this.opts.config)));
		return {commit, repos: this.repos};
	}

	// compact rewrites every store repository this run fetched into as one pack
	// of whole, uncompressed objects. A warm checkout then copies each file
	// instead of inflating it and applying deltas, which on a large tree is most
	// of its CPU.
	// It also stores a copy of every worktree the store lacks. The result counts
	// what this run added, so a worktree this run took and put back is not counted.
	async compact(): Promise<number> {
		const stores = [...this.fetchedStores];
		const [, kept] = await Promise.all([
			Promise.all(stores.map(store => this.opts.git.must(['-c', 'pack.compression=0', 'repack', '-a', '-d', '-F', '--window=0', '-q'], store))),
			Promise.all(this.written.map(repo => this.keep(repo))),
		]);
		return stores.length + kept.filter(added => added).length;
	}

	// treePath is where the store keeps the worktree of one commit of one url.
	private treePath(repo: Repo): string | undefined {
		const commit = wanted(repo);
		if (this.opts.store === undefined || this.opts.store === '' || commit === undefined) {
			return undefined;
		}
		return path.join(this.opts.store, 'trees', storeKey(repo.url), commit);
	}

	// place moves the stored worktree of the commit into the repository's
	// directory. A rename costs the same for any number of files.
	private async place(repo: Repo): Promise<void> {
		const tree = this.treePath(repo);
		if (tree === undefined) {
			return;
		}
		try {
			await fsp.rename(tree, repo.dir);
		} catch (error) {
			const code = (error as {code?: string}).code;
			if (code !== 'ENOENT') {
				this.opts.log(`${repo.label}: the stored worktree did not move into place (${code}), so git writes it`);
			}
			return;
		}
		repo.placed = true;
	}

	// keep copies a finished worktree into the store, without its git link and
	// without the contents of its submodules. It gives back whether the store
	// gained a worktree it did not have at the start of this run.
	private async keep(repo: Repo): Promise<boolean> {
		const tree = this.treePath(repo);
		if (tree === undefined || fs.existsSync(tree)) {
			return false;
		}
		const own = path.join(repo.dir, '.git');
		const links = new Set((repo.links ?? []).map(at => path.join(repo.dir, at)));
		const staging = `${tree}.${process.pid}`;
		await fsp.rm(staging, {recursive: true, force: true});
		await fsp.cp(repo.dir, staging, {
			recursive: true,
			verbatimSymlinks: true,
			mode: fs.constants.COPYFILE_FICLONE,
			filter: source => source !== own && !links.has(path.dirname(source)),
		});
		await this.evict(path.dirname(tree));
		try {
			await fsp.rename(staging, tree);
		} catch (error) {
			// Another job stored the same commit first.
			await fsp.rm(staging, {recursive: true, force: true});
			this.opts.log(`${repo.label}: the store already holds this worktree (${(error as {code?: string}).code})`);
			return false;
		}
		this.opts.log(`${repo.label}: worktree stored for the next checkout`);
		return !repo.placed;
	}

	// evict keeps the newest worktrees of one url, so a store on a runner that
	// keeps its tool cache does not grow with every commit.
	private async evict(dir: string): Promise<void> {
		const entries = await fsp.readdir(dir, {withFileTypes: true});
		const trees = entries.filter(entry => entry.isDirectory() && SHA.test(entry.name));
		const stamped = await Promise.all(trees.map(async entry => ({at: path.join(dir, entry.name), mtime: (await fsp.stat(path.join(dir, entry.name))).mtimeMs})));
		stamped.sort((a, b) => b.mtime - a.mtime);
		await Promise.all(stamped.slice(keptTrees - 1).map(entry => fsp.rm(entry.at, {recursive: true, force: true})));
	}

	private async take(repo: Repo, early?: () => Promise<Tree | undefined>, parentReady?: Promise<void>): Promise<string> {
		this.repos += 1;
		const started = Date.now();
		// The parent made this directory before its own checkout, so the git directory can link to it at once.
		await parentReady;
		// The stored worktree moves in before the git directory exists, because a rename needs an empty target.
		await this.place(repo);
		await this.init(repo);
		const fetching = this.fetch(repo, started);

		// The worktree and the children share nothing, so they overlap.
		let tree: Promise<Tree | undefined>;
		if (repo.submodules === 'false') {
			tree = Promise.resolve(undefined);
		} else if (early === undefined) {
			tree = fetching.then(commit => this.treeOf(repo, commit));
		} else {
			// Whichever answers first wins: a store hit reads the tree locally before the API round trip lands.
			const local = fetching.then(commit => this.treeOf(repo, commit));
			tree = Promise.race([early().then(found => found ?? local), local]);
		}
		// git checkout dies when a directory it saw as missing appears while it writes.
		const ready = tree.then(found => {
			repo.links = found === undefined ? [] : [...found.links.keys()];
			return this.makeSubmoduleDirs(repo, found);
		});
		const written = Promise.all([fetching, ready, parentReady]).then(() => this.writeTree(repo, started));
		await Promise.all([written, tree.then(found => this.children(repo, found, ready))]);
		return fetching;
	}

	private async fetch(repo: Repo, started: number): Promise<string> {
		if (this.opts.store !== undefined && this.opts.store !== '') {
			try {
				const {commit, hit} = await this.fromStore(repo, this.opts.store);
				this.opts.log(`${repo.label}: ${hit ? 'took' : 'fetched'} ${commit} ${hit ? 'from the store' : 'into the store'} in ${ms(started)}`);
				return commit;
			} catch (e) {
				this.opts.log(`${repo.label}: the store failed, so it fetches directly: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		const fetchArgs = ['fetch', '--no-tags', '--quiet'];
		if (this.opts.depth > 0) {
			fetchArgs.push(`--depth=${this.opts.depth}`);
		}
		await this.opts.git.must([...fetchArgs, 'origin', repo.refspec], repo.gitdir);
		const commit = (await this.opts.git.must(['rev-parse', '--verify', `${repo.target}^{commit}`], repo.gitdir)).trim();
		this.opts.log(`${repo.label}: fetched ${commit} in ${ms(started)}`);
		return commit;
	}

	// fromStore puts the target commit in this url's store repository, fetching
	// only when the store lacks it, and points the repository at the store.
	private async fromStore(repo: Repo, root: string): Promise<{commit: string; hit: boolean}> {
		const git = this.opts.git;
		const store = path.join(root, `${storeKey(repo.url)}.git`);
		const spec = repo.refspec.replace(/^\+/, '');
		const sep = spec.indexOf(':');
		const want = sep < 0 ? spec : spec.slice(0, sep);
		const local = sep < 0 ? '' : spec.slice(sep + 1);
		const previous = this.storeLocks.get(store) ?? Promise.resolve();
		const found = previous.catch(() => undefined).then(async () => {
			if (!fs.existsSync(path.join(store, 'HEAD'))) {
				await fsp.mkdir(store, {recursive: true});
				await git.must(['init', '--quiet', '--bare', store]);
				await git.must(['config', 'gc.auto', '0'], store);
			}
			// The ref this store keeps for every commit it fetched answers without a process. cat-file covers a commit fetched another way.
			if (SHA.test(want) && (fs.existsSync(path.join(store, 'refs', 'parallel-checkout', want)) || (await git.run(['cat-file', '-e', `${want}^{commit}`], store)).code === 0)) {
				return {commit: want, hit: true};
			}
			const keep = SHA.test(want) ? `refs/parallel-checkout/${want}` : `refs/parallel-checkout/fetch-${process.pid}`;
			const fetchArgs = ['fetch', '--no-tags', '--quiet'];
			if (this.opts.depth > 0) {
				fetchArgs.push(`--depth=${this.opts.depth}`);
			}
			await git.must([...fetchArgs, repo.url, `+${want}:${keep}`], store);
			this.fetchedStores.add(store);
			const commit = (await git.must(['rev-parse', '--verify', `${keep}^{commit}`], store)).trim();
			if (!SHA.test(want)) {
				await git.must(['update-ref', `refs/parallel-checkout/${commit}`, commit], store);
				await git.must(['update-ref', '-d', keep], store);
			}
			return {commit, hit: false};
		});
		this.storeLocks.set(store, found);
		const {commit, hit} = await found;

		await fsp.mkdir(path.join(repo.gitdir, 'objects', 'info'), {recursive: true});
		await fsp.writeFile(path.join(repo.gitdir, 'objects', 'info', 'alternates'), `${path.join(store, 'objects')}\n`);
		// Without the store's shallow list, git walks past a depth-limited commit into parents nobody fetched.
		const shallow = path.join(store, 'shallow');
		if (fs.existsSync(shallow)) {
			await fsp.copyFile(shallow, path.join(repo.gitdir, 'shallow'));
		}
		// The target is the commit itself or the ref this writes, so it needs no rev-parse.
		if (local !== '') {
			await fsp.mkdir(path.dirname(path.join(repo.gitdir, local)), {recursive: true});
			await fsp.writeFile(path.join(repo.gitdir, local), `${commit}\n`);
		}
		repo.objects = store;
		return {commit, hit};
	}

	// treeOf reads a fetched commit's submodule facts out of the object store,
	// so it runs while the worktree is still being written.
	private async treeOf(repo: Repo, commit: string): Promise<Tree | undefined> {
		const git = this.opts.git;
		const where = repo.objects ?? repo.gitdir;
		const listing = await git.must(['ls-tree', '-r', commit], where);
		if (!/^100644 blob [0-9a-f]+\t\.gitmodules$/m.test(listing)) {
			return undefined;
		}
		return {gitmodules: await git.must(['show', `${commit}:.gitmodules`], where), links: gitlinks(listing)};
	}

	// init writes the git directory from the template one real `git init` made, so a tree of many repositories spawns no git per repository here.
	private async init(repo: Repo): Promise<void> {
		this.written.push(repo);
		const settings: Array<[string, string]> = [
			['gc.auto', '0'],
			['remote.origin.url', repo.url],
			['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
		];
		if (fs.existsSync(path.join(repo.gitdir, 'HEAD'))) {
			// A repository already here keeps its own config, and gets only what the checkout reads.
			await this.configure(repo, settings);
			return;
		}
		const template = await this.template();
		await fsp.mkdir(repo.dir, {recursive: true});
		await Promise.all(['objects/info', 'objects/pack', 'refs/heads', 'refs/tags'].map(at => fsp.mkdir(path.join(repo.gitdir, at), {recursive: true})));
		const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
		let config = `${template.config}[gc]\n\tauto = 0\n[remote "origin"]\n\turl = ${quote(repo.url)}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
		if (nested(repo)) {
			// The same relative links git's own submodule plumbing writes, so the tree still works if the workspace moves.
			config += `[core]\n\tworktree = ${quote(path.relative(repo.gitdir, repo.dir))}\n`;
			await fsp.writeFile(path.join(repo.dir, '.git'), `gitdir: ${path.relative(repo.dir, repo.gitdir)}\n`);
		}
		await fsp.writeFile(path.join(repo.gitdir, 'HEAD'), template.head);
		await fsp.writeFile(path.join(repo.gitdir, 'config'), config);
	}

	// template runs `git init` once, so every repository gets the core settings git probes from this file system.
	private template(): Promise<{config: string; head: string}> {
		this.templated ??= (async () => {
			const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'parallel-checkout-template-'));
			try {
				await this.opts.git.must(['init', '--quiet', dir]);
				const config = await fsp.readFile(path.join(dir, '.git', 'config'), 'utf8');
				const head = await fsp.readFile(path.join(dir, '.git', 'HEAD'), 'utf8');
				return {config: config.endsWith('\n') ? config : `${config}\n`, head};
			} finally {
				await fsp.rm(dir, {recursive: true, force: true});
			}
		})();
		return this.templated;
	}

	private async writeTree(repo: Repo, started: number): Promise<void> {
		if (repo.placed) {
			await this.indexTree(repo);
		} else {
			const args = ['-c', `checkout.workers=${this.opts.workers}`, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force'];
			if (repo.branch !== undefined) {
				// --no-track keeps checkout out of .git/config, which the submodule registrations are writing at the same time.
				args.push('--no-track', '-B', repo.branch);
			}
			args.push(repo.target);
			await this.opts.git.must(args, repo.dir);
		}
		if (repo.branch !== undefined) {
			const branch = repo.branch;
			await this.configure(repo, [
				[`branch.${branch}.remote`, 'origin'],
				[`branch.${branch}.merge`, `refs/heads/${branch}`],
			]);
		}
		this.opts.log(`${repo.label}: worktree ${repo.placed ? 'taken from the store' : 'written'} in ${ms(started)}`);
	}

	// indexTree points HEAD at the commit and reads its tree into the index,
	// over files already in place. The index then holds no file stats, so the
	// first git status reads each file once and finds it clean.
	private async indexTree(repo: Repo): Promise<void> {
		const git = this.opts.git;
		const commit = wanted(repo)!;
		if (repo.branch === undefined) {
			await git.must(['update-ref', '--no-deref', 'HEAD', commit], repo.dir);
		} else {
			await git.must(['update-ref', `refs/heads/${repo.branch}`, commit], repo.dir);
			await git.must(['symbolic-ref', 'HEAD', `refs/heads/${repo.branch}`], repo.dir);
		}
		await git.must(['read-tree', commit], repo.dir);
	}

	// makeSubmoduleDirs creates the directory of every submodule the tree pins.
	private async makeSubmoduleDirs(repo: Repo, tree: Tree | undefined): Promise<void> {
		if (tree === undefined) {
			return;
		}
		await Promise.all([...tree.links.keys()].map(at => fsp.mkdir(path.join(repo.dir, at), {recursive: true})));
	}

	// children starts every submodule a tree names.
	private async children(repo: Repo, tree: Tree | undefined, ready: Promise<void>): Promise<void> {
		if (tree === undefined) {
			return;
		}
		const modules = parseGitmodules(tree.gitmodules);
		const below: Submodules = repo.submodules === 'recursive' ? 'recursive' : 'false';
		const tasks: Array<Promise<string>> = [];
		for (const module of modules) {
			const sha = tree.links.get(module.path);
			if (sha === undefined) {
				// .gitmodules names it but the tree carries no gitlink: git's own `submodule update` skips it too.
				this.opts.log(`${repo.label}: ${module.path} is in .gitmodules but not in the tree, skipped`);
				continue;
			}
			const url = resolveUrl(module.url, repo.url);
			const child: Repo = {
				dir: path.join(repo.dir, module.path),
				gitdir: gitdirFor(repo.gitdir, module.name),
				url,
				refspec: sha,
				target: sha,
				submodules: below,
				label: path.relative(this.opts.dir, path.join(repo.dir, module.path)),
			};
			// Only the superproject's direct submodules follow a branch; a dependency's own submodules sit at the commits it names.
			const follow = repo.dir === this.opts.dir && this.opts.follow !== undefined && followed(url, this.opts.follow.scope) ? this.opts.follow : undefined;
			const registered = this.register(repo, module.name, url);
			if (follow === undefined) {
				// The checkout reads nothing the registration writes, so both overlap.
				tasks.push(Promise.all([registered, this.take(child, undefined, ready)]).then(([, commit]) => commit));
				continue;
			}
			tasks.push(
				registered.then(async () => {
					const head = await this.headOf(child, follow.branch, module.branch);
					if (this.opts.lockHead !== undefined) {
						const locked = await this.opts.lockHead(url, head.branch, head.sha);
						if (locked !== head.sha) {
							this.opts.log(`${child.label}: takes ${locked}, the commit this run locked on ${head.branch}, not the current head ${head.sha}`);
						}
						head.sha = locked;
					}
					child.refspec = `+${head.sha}:refs/remotes/origin/${head.branch}`;
					child.target = head.sha;
					await this.configure(repo, [[`submodule.${module.name}.branch`, head.branch]]);
					this.opts.log(`${child.label}: follows ${head.branch} at ${head.sha}, not the gitlink ${sha}`);
					return this.take(child, undefined, ready);
				}),
			);
		}
		await Promise.all(tasks);
	}

	// headOf asks a followed submodule's remote, in one round trip, for the
	// branches it may take and which is the default.
	private async headOf(child: Repo, here: string, configured: string): Promise<Head> {
		const refs = ['HEAD', `refs/heads/${here}`];
		if (configured !== '' && configured !== '.' && configured !== here) {
			refs.push(`refs/heads/${configured}`);
		}
		// Run inside the superproject, whose config.
		const listing = await this.opts.git.must(['ls-remote', '--symref', child.url, ...refs], this.opts.dir);
		try {
			return pickHead(here, configured, listing);
		} catch (error) {
			throw new Error(`${child.label}: cannot follow a branch on ${child.url}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// register records the submodule in its parent's config, which is what
	// `git submodule status` and later submodule commands read.
	// It appends one new section rather than spawning a git config per key, because every submodule of a parent queues on that parent's config.
	private register(parent: Repo, name: string, url: string): Promise<void> {
		const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
		const section = `[submodule ${quote(name)}]\n\turl = ${quote(url)}\n\tactive = true\n`;
		const previous = this.configLocks.get(parent.gitdir) ?? Promise.resolve();
		const next = previous.then(() => fsp.appendFile(path.join(parent.gitdir, 'config'), section));
		this.configLocks.set(parent.gitdir, next);
		return next;
	}

	// configure writes into one repository's config, one writer at a time per
	// repository, because `git config` gives up on a held lock instead of waiting.
	private configure(repo: Repo, settings: Array<[string, string]>): Promise<void> {
		const previous = this.configLocks.get(repo.gitdir) ?? Promise.resolve();
		const next = previous.then(async () => {
			for (const [key, value] of settings) {
				await this.opts.git.must(['config', '--local', key, value], repo.gitdir);
			}
		});
		this.configLocks.set(repo.gitdir, next);
		return next;
	}
}

// How many worktrees of one url the store keeps.
const keptTrees = 4;

function storeKey(url: string): string {
	return url.replace(/^[a-z]+:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_');
}

// wanted is the commit a repository's fetch asks for, when the fetch names one.
function wanted(repo: Repo): string | undefined {
	const want = repo.refspec.replace(/^\+/, '').split(':')[0];
	return SHA.test(want) ? want : undefined;
}

// nested says whether a repository's git directory lives apart from its worktree, as a submodule's does.
function nested(repo: Repo): boolean {
	return repo.gitdir !== path.join(repo.dir, '.git');
}
