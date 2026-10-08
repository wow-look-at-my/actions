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

function take(fx: Fixture, dir: string, submodules: 'false' | 'true' | 'recursive', ref = 'refs/heads/main', sha = head(fx.top), rootTree?: Early) {
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
		log: message => log.push(message),
	});
	return {checkout, log};
}

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

test('a submodule whose fetch fails takes the whole checkout down with its name', async () => {
	const fx = fixture();
	// The tree still pins leaf, but the repository behind it is gone.
	fs.rmSync(fx.leaf, {recursive: true});
	const dir = path.join(fx.root, 'work');
	await assert.rejects(take(fx, dir, 'recursive').checkout.run(), /git fetch .*leaf/);
});
