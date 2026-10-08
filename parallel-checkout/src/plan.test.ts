import * as assert from 'assert';
import {test} from 'node:test';
import {basicAuth, followed, gitdirFor, gitlinks, parseGitmodules, pickHead, pickRef, planRef, resolveUrl} from './plan';

test('a .gitmodules file reads into name, path and url', () => {
	const text = `[submodule "x/crypto"]\n\tpath = src/vendor/golang.org/x/crypto\n\turl = https://github.com/golang/crypto\n\tbranch = master\n[submodule "bats"]\n\tpath = test_helper/bats-assert\n\turl = ../bats-assert.git\n`;
	assert.deepStrictEqual(parseGitmodules(text), [
		{name: 'x/crypto', path: 'src/vendor/golang.org/x/crypto', url: 'https://github.com/golang/crypto', branch: 'master'},
		{name: 'bats', path: 'test_helper/bats-assert', url: '../bats-assert.git', branch: ''},
	]);
});

test('a .gitmodules branch is read, and defaults to empty', () => {
	const text = `[submodule "a"]\n\tpath = a\n\turl = ../a\n\tbranch = .\n[submodule "b"]\n\tpath = b\n\turl = ../b\n`;
	assert.deepStrictEqual(
		parseGitmodules(text).map(module => module.branch),
		['.', ''],
	);
});

test('a submodule follows a branch only inside the scope', () => {
	assert.ok(followed('https://github.com/org/dep', ['https://github.com/org/']));
	assert.ok(!followed('https://github.com/other/dep', ['https://github.com/org/']));
	assert.ok(!followed('https://github.com/org/dep', ['']));
});

const listing = 'ref: refs/heads/main\tHEAD\naaa1111111111111111111111111111111111111\tHEAD\nbbb1111111111111111111111111111111111111\trefs/heads/feature\nccc1111111111111111111111111111111111111\trefs/heads/release\n';

test('the superproject branch wins when the remote has it', () => {
	assert.deepStrictEqual(pickHead('feature', 'release', listing), {branch: 'feature', sha: 'bbb1111111111111111111111111111111111111'});
});

test('the .gitmodules branch is next, and `.` means the superproject branch', () => {
	assert.deepStrictEqual(pickHead('nope', 'release', listing), {branch: 'release', sha: 'ccc1111111111111111111111111111111111111'});
	assert.deepStrictEqual(pickHead('nope', '.', listing), {branch: 'main', sha: 'aaa1111111111111111111111111111111111111'});
});

test('the default branch is the last fallback, and no branch at all fails', () => {
	assert.deepStrictEqual(pickHead('nope', '', listing), {branch: 'main', sha: 'aaa1111111111111111111111111111111111111'});
	assert.throws(() => pickHead('nope', '', ''), /none of nope/);
});

test('a submodule with no url fails loudly', () => {
	assert.throws(() => parseGitmodules('[submodule "a"]\n\tpath = a\n'), /submodule "a" has no url/);
});

test('an empty file holds no submodules', () => {
	assert.deepStrictEqual(parseGitmodules(''), []);
});

test('gitlinks come out of ls-tree and blobs do not', () => {
	const out = gitlinks('100644 blob abc\tREADME\n160000 commit 9beb694f9766a2c69fe6c89cfa6cf653a32b5a27\tsrc/vendor/x\n');
	assert.deepStrictEqual([...out], [['src/vendor/x', '9beb694f9766a2c69fe6c89cfa6cf653a32b5a27']]);
});

test('a relative url drops one component per ../ from the superproject remote', () => {
	assert.strictEqual(resolveUrl('../bats-assert.git', 'https://github.com/org/repo.git'), 'https://github.com/org/bats-assert.git');
	assert.strictEqual(resolveUrl('../../other/x', 'https://github.com/org/repo'), 'https://github.com/other/x');
	assert.strictEqual(resolveUrl('./sub', 'https://github.com/org/repo/'), 'https://github.com/org/repo/sub');
	assert.strictEqual(resolveUrl('../x', 'git@github.com:org/repo.git'), 'git@github.com:org/x');
	assert.strictEqual(resolveUrl('../x', '/srv/git/org/repo'), '/srv/git/org/x');
});

test('an absolute url passes through', () => {
	assert.strictEqual(resolveUrl('https://example.com/a', 'https://github.com/org/repo'), 'https://example.com/a');
});

test('climbing above the host fails', () => {
	assert.throws(() => resolveUrl('../../../x', 'https://github.com/org/repo'), /cannot resolve/);
});

test('a branch ref fetches to a remote-tracking ref and checks out a local branch', () => {
	assert.deepStrictEqual(planRef('refs/heads/main', 'abc'), {
		refspec: '+abc:refs/remotes/origin/main',
		branch: 'main',
		target: 'refs/remotes/origin/main',
	});
});

test('a pull ref and a tag check out detached', () => {
	assert.deepStrictEqual(planRef('refs/pull/7/merge', 'abc'), {refspec: '+abc:refs/remotes/pull/7/merge', target: 'refs/remotes/pull/7/merge'});
	assert.deepStrictEqual(planRef('refs/tags/v1', ''), {refspec: '+refs/tags/v1:refs/tags/v1', target: 'refs/tags/v1'});
});

test('a bare commit checks out detached at itself', () => {
	const sha = 'c2fce1410da52e977c1c76e4fcd0ab0f96f810fb';
	assert.deepStrictEqual(planRef(sha, ''), {refspec: `+${sha}:refs/remotes/origin/detached`, target: sha});
	assert.deepStrictEqual(planRef('', sha), {refspec: `+${sha}:refs/remotes/origin/detached`, target: sha});
});

test('a bare name is not planned until the remote says what it is', () => {
	assert.throws(() => planRef('main', ''), /resolve it first/);
	assert.throws(() => planRef('', ''), /no ref to check out/);
});

test('pickRef prefers a branch over a tag of the same name', () => {
	const listing = 'abc\trefs/heads/v1\ndef\trefs/tags/v1\n';
	assert.strictEqual(pickRef('v1', listing), 'refs/heads/v1');
	assert.strictEqual(pickRef('v1', 'def\trefs/tags/v1\n'), 'refs/tags/v1');
	assert.throws(() => pickRef('nope', listing), /not a branch or a tag/);
});

test('a submodule name cannot climb out of the modules directory', () => {
	assert.strictEqual(gitdirFor('/w/.git', 'x/crypto'), '/w/.git/modules/x/crypto');
	assert.throws(() => gitdirFor('/w/.git', '../escape'), /escape/);
});

test('the auth header is what actions/checkout sends', () => {
	assert.strictEqual(basicAuth('tok'), Buffer.from('x-access-token:tok').toString('base64'));
});
