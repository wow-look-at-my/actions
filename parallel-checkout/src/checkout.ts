import * as fsp from 'fs/promises';
import * as path from 'path';
import {Git} from './git';
import {Head, RefPlan, followed, gitdirFor, gitlinks, parseGitmodules, pickHead, resolveUrl} from './plan';

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
	// A label for the log.
	label: string;
};

export function ms(since: number): string {
	return `${Date.now() - since}ms`;
}

// Checkout walks a repository and its submodule tree. Every repository is
// fetched as soon as its commit is known, which for a submodule is the moment
// its parent's fetch lands. Every worktree is written as soon as its own
// fetch lands. Nothing waits on a sibling.
export class Checkout {
	private repos = 0;
	private readonly dirs: string[] = [];
	// Config writes into one repository are serialized.
	private readonly configLocks = new Map<string, Promise<void>>();

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
		await Promise.all(
			this.dirs.map(async dir => {
				for (const [key, value] of this.opts.config) {
					await this.opts.git.must(['config', '--local', key, value], dir);
				}
			}),
		);
		return {commit, repos: this.repos};
	}

	private async take(repo: Repo, early?: () => Promise<Tree | undefined>): Promise<string> {
		this.repos += 1;
		const started = Date.now();
		await this.init(repo);
		const fetching = this.fetch(repo, started);

		// The worktree and the children share nothing, so they overlap.
		let tree: Promise<Tree | undefined>;
		if (repo.submodules === 'false') {
			tree = Promise.resolve(undefined);
		} else if (early === undefined) {
			tree = fetching.then(commit => this.treeOf(repo, commit));
		} else {
			tree = early().then(found => found ?? fetching.then(commit => this.treeOf(repo, commit)));
		}
		await Promise.all([fetching.then(() => this.writeTree(repo, started)), tree.then(found => this.children(repo, found))]);
		return fetching;
	}

	private async fetch(repo: Repo, started: number): Promise<string> {
		const fetchArgs = ['fetch', '--no-tags', '--quiet'];
		if (this.opts.depth > 0) {
			fetchArgs.push(`--depth=${this.opts.depth}`);
		}
		await this.opts.git.must([...fetchArgs, 'origin', repo.refspec], repo.dir);
		const commit = (await this.opts.git.must(['rev-parse', '--verify', `${repo.target}^{commit}`], repo.dir)).trim();
		this.opts.log(`${repo.label}: fetched ${commit} in ${ms(started)}`);
		return commit;
	}

	// treeOf reads a fetched commit's submodule facts out of the object store,
	// so it runs while the worktree is still being written.
	private async treeOf(repo: Repo, commit: string): Promise<Tree | undefined> {
		const git = this.opts.git;
		const listing = await git.must(['ls-tree', '-r', commit], repo.dir);
		if (!/^100644 blob [0-9a-f]+\t\.gitmodules$/m.test(listing)) {
			return undefined;
		}
		return {gitmodules: await git.must(['show', `${commit}:.gitmodules`], repo.dir), links: gitlinks(listing)};
	}

	private async init(repo: Repo): Promise<void> {
		const git = this.opts.git;
		await fsp.mkdir(repo.dir, {recursive: true});
		const initArgs = ['init', '--quiet'];
		const nested = repo.gitdir !== path.join(repo.dir, '.git');
		if (nested) {
			await fsp.mkdir(path.dirname(repo.gitdir), {recursive: true});
			initArgs.push(`--separate-git-dir=${repo.gitdir}`);
		}
		await git.must([...initArgs, repo.dir]);
		if (nested) {
			// The same relative links git's own submodule plumbing writes, so the tree still works if the workspace moves.
			await fsp.writeFile(path.join(repo.dir, '.git'), `gitdir: ${path.relative(repo.dir, repo.gitdir)}\n`);
			await git.must(['config', '--local', 'core.worktree', path.relative(repo.gitdir, repo.dir)], repo.dir);
		}
		await git.must(['config', '--local', 'gc.auto', '0'], repo.dir);
		this.dirs.push(repo.dir);
		await git.must(['remote', 'add', 'origin', repo.url], repo.dir);
	}

	private async writeTree(repo: Repo, started: number): Promise<void> {
		const args = ['-c', `checkout.workers=${this.opts.workers}`, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force'];
		if (repo.branch !== undefined) {
			// --no-track keeps checkout out of .git/config, which the submodule registrations are writing at the same time.
			args.push('--no-track', '-B', repo.branch);
		}
		args.push(repo.target);
		await this.opts.git.must(args, repo.dir);
		if (repo.branch !== undefined) {
			const branch = repo.branch;
			await this.configure(repo, [
				[`branch.${branch}.remote`, 'origin'],
				[`branch.${branch}.merge`, `refs/heads/${branch}`],
			]);
		}
		this.opts.log(`${repo.label}: worktree written in ${ms(started)}`);
	}

	// children starts every submodule a tree names.
	private async children(repo: Repo, tree: Tree | undefined): Promise<void> {
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
			tasks.push(
				this.register(repo, module.name, url).then(async () => {
					if (follow !== undefined) {
						const head = await this.headOf(child, follow.branch, module.branch);
						child.refspec = `+${head.sha}:refs/remotes/origin/${head.branch}`;
						child.target = head.sha;
						await this.configure(repo, [[`submodule.${module.name}.branch`, head.branch]]);
						this.opts.log(`${child.label}: follows ${head.branch} at ${head.sha}, not the gitlink ${sha}`);
					}
					return this.take(child);
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
	private register(parent: Repo, name: string, url: string): Promise<void> {
		return this.configure(parent, [
			[`submodule.${name}.url`, url],
			[`submodule.${name}.active`, 'true'],
		]);
	}

	// configure writes into one repository's config, one writer at a time per
	// repository, because `git config` gives up on a held lock instead of waiting.
	private configure(repo: Repo, settings: Array<[string, string]>): Promise<void> {
		const previous = this.configLocks.get(repo.gitdir) ?? Promise.resolve();
		const next = previous.then(async () => {
			for (const [key, value] of settings) {
				await this.opts.git.must(['config', '--local', key, value], repo.dir);
			}
		});
		this.configLocks.set(repo.gitdir, next);
		return next;
	}
}
