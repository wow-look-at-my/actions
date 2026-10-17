import * as assert from 'assert';
import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {test} from 'node:test';
import {Checkout, Tree} from './checkout';
import {Git, Pool} from './git';
import {planRef} from './plan';

function sh(args: string[], cwd: string): string {
	return execFileSync('git', args, {cwd, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}});
}

// A repository on disk that serves single commits by id, as GitHub does.
function origin(root: string, name: string, files: Record<string, string>): string {
	const dir = path.join(root, name);
	fs.mkdirSync(dir, {recursive: true});
	sh(['init', '--quiet', '--initial-branch=main'], dir);
	sh(['config', 'uploadpack.allowAnySHA1InWant', 'true'], dir);
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
		fs.writeFileSync(path.join(dir, file), text);
	}
	sh(['add', '-A'], dir);
	sh(['commit', '--quiet', '-m', 'init'], dir);
	return dir;
}

// link adds a gitlink at `at` pointing at the head of `child`, under a relative url.
function link(superDir: string, child: string, at: string, name: string): void {
	sh(['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', '--name', name, `../${path.basename(child)}`, at], superDir);
	sh(['commit', '--quiet', '-m', `add ${at}`], superDir);
}

function head(dir: string): string {
	return sh(['rev-parse', 'HEAD'], dir).trim();
}

type Fixture = {root: string; top: string; mid: string; leaf: string; plain: string};

function fixture(): Fixture {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-checkout-'));
	const leaf = origin(root, 'leaf', {'leaf.txt': 'leaf\n'});
	const plain = origin(root, 'plain', {'plain.txt': 'plain\n'});
	const mid = origin(root, 'mid', {'mid.txt': 'mid\n'});
	link(mid, leaf, 'deps/leaf', 'leafmod');
	const top = origin(root, 'top', {'top.txt': 'top\n', 'docs/readme': 'r\n'});
	link(top, mid, 'vendor/mid', 'mid');
	link(top, plain, 'vendor/plain', 'plain');
	return {root, top, mid, leaf, plain};
}

type Early = () => Promise<Tree | undefined>;
type Follow = {branch: string; scope: string[]};

// advance commits a new file on `branch` of an origin, creating the branch if needed, and returns the new head.
function advance(dir: string, branch: string, file: string): string {
	sh(['checkout', '--quiet', '-B', branch], dir);
	fs.writeFileSync(path.join(dir, file), `${file}\n`);
	sh(['add', '-A'], dir);
	sh(['commit', '--quiet', '-m', `advance ${branch}`], dir);
	return head(dir);
}

type LockHead = (url: string, branch: string, head: string) => Promise<string>;

function take(fx: Fixture, dir: string, submodules: 'false' | 'true' | 'recursive', ref = 'refs/heads/main', sha = head(fx.top), rootTree?: Early, follow?: Follow, lockHead?: LockHead) {
	const log: string[] = [];
	const checkout = new Checkout({
		git: new Git(new Pool(8), ['-c', 'protocol.file.allow=always']),
		dir,
		url: fx.top,
		plan: planRef(ref, sha),
		depth: 1,
		submodules,
		workers: 2,
		config: [['test.marker', 'yes']],
		rootTree,
		follow,
		lockHead,
		log: message => log.push(message),
	});
	return {checkout, log};
}

test('a followed submodule takes the commit the run locked, not a newer head', async () => {
	const fx = fixture();
	const locks = new Map<string, string>();
	const lockHead: LockHead = async (url, branch, sha) => {
		const name = `${url}@${branch}`;
		if (!locks.has(name)) {
			locks.set(name, sha);
		}
		return locks.get(name)!;
	};
	const follow = {branch: 'feature', scope: [`${fx.root}/`]};
	const first = advance(fx.mid, 'feature', 'first.txt');
	await take(fx, path.join(fx.root, 'one'), 'recursive', undefined, undefined, undefined, follow, lockHead).checkout.run();
	// The branch moves between the jobs of one run.
	const second = advance(fx.mid, 'feature', 'second.txt');
	const {checkout, log} = take(fx, path.join(fx.root, 'two'), 'recursive', undefined, undefined, undefined, follow, lockHead);
	await checkout.run();

	assert.strictEqual(head(path.join(fx.root, 'one', 'vendor/mid')), first);
	assert.strictEqual(head(path.join(fx.root, 'two', 'vendor/mid')), first);
	assert.ok(log.some(line => line.includes(`takes ${first}, the commit this run locked on feature, not the current head ${second}`)), log.join('\n'));
});

test('a followed submodule takes the superproject branch head, then the default branch, and nested ones stay pinned', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	// The gitlinks in top still name the heads of mid and plain.
	const midPinned = head(fx.mid);
	const midFeature = advance(fx.mid, 'feature', 'feature.txt');
	const plainMain = advance(fx.plain, 'main', 'later.txt');
	const leafLater = advance(fx.leaf, 'main', 'later.txt');
	const {checkout, log} = take(fx, dir, 'recursive', undefined, undefined, undefined, {branch: 'feature', scope: [`${fx.root}/`]});
	await checkout.run();

	// mid has a feature branch; plain has none and takes its default branch head.
	assert.strictEqual(head(path.join(dir, 'vendor/mid')), midFeature);
	assert.ok(fs.existsSync(path.join(dir, 'vendor/mid/feature.txt')));
	assert.strictEqual(head(path.join(dir, 'vendor/plain')), plainMain);
	// mid's own submodule sits at the commit mid names, not at leaf's newest head.
	assert.notStrictEqual(head(path.join(dir, 'vendor/mid/deps/leaf')), leafLater);
	assert.strictEqual(sh(['submodule', 'status', '--recursive'], path.join(dir, 'vendor/mid')).startsWith(' '), true);
	// The superproject's gitlink now differs, and git says so, which is the point.
	assert.match(sh(['status', '--porcelain'], dir), /^ M vendor\/mid$/m);
	assert.strictEqual(sh(['config', '--local', 'submodule.mid.branch'], dir).trim(), 'feature');
	assert.strictEqual(sh(['config', '--local', 'submodule.plain.branch'], dir).trim(), 'main');
	assert.ok(log.some(line => line.includes(`vendor/mid: follows feature at ${midFeature}, not the gitlink ${midPinned}`)), log.join('\n'));
});

test('a submodule outside the scope keeps its gitlink', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const plainPinned = head(fx.plain);
	advance(fx.plain, 'feature', 'feature.txt');
	const midFeature = advance(fx.mid, 'feature', 'feature.txt');
	const {checkout} = take(fx, dir, 'recursive', undefined, undefined, undefined, {branch: 'feature', scope: [fx.mid]});
	await checkout.run();
	assert.strictEqual(head(path.join(dir, 'vendor/mid')), midFeature);
	assert.strictEqual(head(path.join(dir, 'vendor/plain')), plainPinned);
});

test('a recursive checkout lands every level at the commit its parent pins', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const {checkout, log} = take(fx, dir, 'recursive');
	const result = await checkout.run();

	assert.strictEqual(result.commit, head(fx.top));
	assert.strictEqual(result.repos, 4);
	assert.strictEqual(fs.readFileSync(path.join(dir, 'top.txt'), 'utf8'), 'top\n');
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/mid/mid.txt'), 'utf8'), 'mid\n');
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/mid/deps/leaf/leaf.txt'), 'utf8'), 'leaf\n');
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/plain/plain.txt'), 'utf8'), 'plain\n');

	// The branch exists locally and tracks origin, as actions/checkout leaves it.
	assert.strictEqual(sh(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(), 'main');
	assert.strictEqual(sh(['rev-parse', 'refs/remotes/origin/main'], dir).trim(), head(fx.top));

	// git itself agrees the tree is clean and every submodule sits at its gitlink.
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
	const status = sh(['submodule', 'status', '--recursive'], dir);
	assert.match(status, new RegExp(`^ ${head(fx.mid)} vendor/mid`, 'm'));
	assert.match(status, new RegExp(`^ ${head(fx.plain)} vendor/plain`, 'm'));
	assert.match(status, new RegExp(`^ ${head(fx.leaf)} vendor/mid/deps/leaf`, 'm'));

	// The submodule repositories live where git keeps them, through relative links.
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/mid/.git'), 'utf8'), 'gitdir: ../../.git/modules/mid\n');
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/mid/deps/leaf/.git'), 'utf8'), 'gitdir: ../../../../.git/modules/mid/modules/leafmod\n');
	assert.ok(fs.existsSync(path.join(dir, '.git/modules/mid/modules/leafmod/HEAD')));

	// The per-repo config reached every level.
	assert.strictEqual(sh(['config', '--local', 'test.marker'], path.join(dir, 'vendor/mid/deps/leaf')).trim(), 'yes');
	assert.strictEqual(sh(['config', '--local', 'gc.auto'], path.join(dir, 'vendor/plain')).trim(), '0');

	// A depth-1 fetch at every level.
	assert.strictEqual(sh(['rev-list', '--count', 'HEAD'], path.join(dir, 'vendor/mid')).trim(), '1');
	assert.strictEqual(log.filter(line => line.includes('fetched')).length, 4);
});

test('a second checkout takes every commit from the store and fetches nothing', async () => {
	const fx = fixture();
	const store = path.join(fx.root, 'store');
	const run = async (into: string) => {
		const log: string[] = [];
		const checkout = new Checkout({
			git: new Git(new Pool(8), ['-c', 'protocol.file.allow=always']),
			dir: path.join(fx.root, into),
			url: fx.top,
			plan: planRef('refs/heads/main', head(fx.top)),
			depth: 1,
			submodules: 'recursive',
			workers: 2,
			config: [],
			store,
			log: message => log.push(message),
		});
		await checkout.run();
		return log;
	};
	const first = await run('one');
	assert.strictEqual(first.filter(line => line.includes('into the store')).length, 4, first.join('\n'));
	const second = await run('two');
	assert.strictEqual(second.filter(line => line.includes('from the store')).length, 4, second.join('\n'));
	assert.ok(!second.some(line => line.includes('store failed')), second.join('\n'));

	const dir = path.join(fx.root, 'two');
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
	assert.match(sh(['submodule', 'status', '--recursive'], dir), new RegExp(`^ ${head(fx.leaf)} vendor/mid/deps/leaf`, 'm'));
	assert.strictEqual(sh(['rev-list', '--count', 'HEAD'], path.join(dir, 'vendor/mid')).trim(), '1');
	assert.strictEqual(sh(['rev-parse', 'refs/remotes/origin/main'], dir).trim(), head(fx.top));
});

test('a checkout of a stored commit moves the stored worktree in, and git finds it clean', async () => {
	const fx = fixture();
	const store = path.join(fx.root, 'store');
	const run = async (into: string) => {
		const log: string[] = [];
		const checkout = new Checkout({
			git: new Git(new Pool(8), ['-c', 'protocol.file.allow=always']),
			dir: path.join(fx.root, into),
			url: fx.top,
			plan: planRef('refs/heads/main', head(fx.top)),
			depth: 1,
			submodules: 'recursive',
			workers: 2,
			config: [],
			store,
			log: message => log.push(message),
		});
		await checkout.run();
		return {log, added: await checkout.compact()};
	};
	const first = await run('one');
	assert.strictEqual(first.added, 8, first.log.join('\n'));
	assert.strictEqual(first.log.filter(line => line.includes('worktree written')).length, 4, first.log.join('\n'));
	const second = await run('two');
	assert.strictEqual(second.log.filter(line => line.includes('worktree taken from the store')).length, 4, second.log.join('\n'));
	// Each worktree went back into the store, and none of them is new to it.
	assert.strictEqual(second.added, 0, second.log.join('\n'));
	assert.strictEqual(second.log.filter(line => line.includes('worktree stored')).length, 4, second.log.join('\n'));

	const dir = path.join(fx.root, 'two');
	assert.strictEqual(fs.readFileSync(path.join(dir, 'vendor/mid/deps/leaf/leaf.txt'), 'utf8'), 'leaf\n');
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
	assert.strictEqual(sh(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(), 'main');
	const status = sh(['submodule', 'status', '--recursive'], dir);
	assert.match(status, new RegExp(`^ ${head(fx.mid)} vendor/mid`, 'm'));
	assert.match(status, new RegExp(`^ ${head(fx.leaf)} vendor/mid/deps/leaf`, 'm'));
	// A stored worktree carries no git link and no submodule contents.
	const kept = path.join(store, 'trees');
	const topTree = path.join(kept, fs.readdirSync(kept).find(name => name.endsWith('top'))!, head(fx.top));
	assert.ok(!fs.existsSync(path.join(topTree, '.git')));
	assert.deepStrictEqual(fs.readdirSync(path.join(topTree, 'vendor/mid')), []);
});

test('one level of submodules stops at the first level', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const result = await take(fx, dir, 'true').checkout.run();
	assert.strictEqual(result.repos, 3);
	assert.ok(fs.existsSync(path.join(dir, 'vendor/mid/mid.txt')));
	assert.ok(!fs.existsSync(path.join(dir, 'vendor/mid/deps/leaf/leaf.txt')));
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
});

test('no submodules leaves the gitlink directories empty', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const result = await take(fx, dir, 'false').checkout.run();
	assert.strictEqual(result.repos, 1);
	assert.ok(fs.existsSync(path.join(dir, 'top.txt')));
	assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'vendor/mid')), []);
});

test('a commit checks out detached at itself', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const sha = head(fx.top);
	const result = await take(fx, dir, 'false', sha, '').checkout.run();
	assert.strictEqual(result.commit, sha);
	assert.strictEqual(sh(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(), 'HEAD');
	assert.strictEqual(sh(['rev-parse', 'HEAD'], dir).trim(), sha);
});

test('an early tree starts the submodules before the superproject fetch lands', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	let asked = 0;
	// What the hosting API would say about the pinned commit, read here from the origin.
	const early: Early = async () => {
		asked += 1;
		return {
			gitmodules: fs.readFileSync(path.join(fx.top, '.gitmodules'), 'utf8'),
			links: new Map([
				['vendor/mid', head(fx.mid)],
				['vendor/plain', head(fx.plain)],
			]),
		};
	};
	const result = await take(fx, dir, 'recursive', undefined, undefined, early).checkout.run();
	assert.strictEqual(asked, 1);
	assert.strictEqual(result.repos, 4);
	assert.ok(fs.existsSync(path.join(dir, 'vendor/mid/deps/leaf/leaf.txt')));
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
	assert.strictEqual(sh(['submodule', 'status', '--recursive'], dir).split('\n').filter(line => line.startsWith(' ')).length, 3);
});

test('an early reader that answers nothing falls back to the fetched commit', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const {checkout} = take(fx, dir, 'recursive', undefined, undefined, async () => undefined);
	assert.strictEqual((await checkout.run()).repos, 4);
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
});

// SlowRootCheckout records which submodule directories exist when the
// superproject's checkout starts, then holds that checkout open. git dies when
// a directory it saw as missing appears while it writes.
class SlowRootCheckout extends Git {
	readonly missing: string[] = [];
	finished = false;

	constructor(private readonly dir: string, private readonly paths: string[]) {
		super(new Pool(8), ['-c', 'protocol.file.allow=always']);
	}

	async must(args: string[], cwd?: string): Promise<string> {
		if (cwd !== this.dir || !args.includes('checkout')) {
			return super.must(args, cwd);
		}
		for (const at of this.paths) {
			if (!fs.statSync(path.join(this.dir, at), {throwIfNoEntry: false})?.isDirectory()) {
				this.missing.push(at);
			}
		}
		// Long enough for every submodule to write its worktree if nothing holds it back.
		await new Promise(resolve => setTimeout(resolve, 1500));
		const out = await super.must(args, cwd);
		this.finished = true;
		return out;
	}
}

test('every submodule directory exists before the superproject checkout, and the submodules write while it runs', async () => {
	const fx = fixture();
	const dir = path.join(fx.root, 'work');
	const git = new SlowRootCheckout(dir, ['vendor/mid', 'vendor/plain']);
	const early: string[] = [];
	const checkout = new Checkout({
		git,
		dir,
		url: fx.top,
		plan: planRef('refs/heads/main', head(fx.top)),
		depth: 1,
		submodules: 'recursive',
		workers: 2,
		config: [],
		log: message => {
			if (!git.finished && /^vendor\/.*: worktree written/.test(message)) {
				early.push(message.split(':')[0]);
			}
		},
	});
	const result = await checkout.run();
	assert.deepStrictEqual(git.missing, []);
	assert.deepStrictEqual(early.sort(), ['vendor/mid', 'vendor/mid/deps/leaf', 'vendor/plain']);
	assert.strictEqual(result.repos, 4);
	assert.strictEqual(sh(['status', '--porcelain'], dir), '');
	assert.doesNotMatch(sh(['submodule', 'status', '--recursive'], dir), /^[^ ]/m);
});

test('a submodule whose fetch fails takes the whole checkout down with its name', async () => {
	const fx = fixture();
	// The tree still pins leaf, but the repository behind it is gone.
	fs.rmSync(fx.leaf, {recursive: true});
	const dir = path.join(fx.root, 'work');
	await assert.rejects(take(fx, dir, 'recursive').checkout.run(), /git fetch .*leaf/);
});
