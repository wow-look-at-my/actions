import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	computeCacheKey,
	computeDigest,
	diffInstalled,
	encodeFileList,
	normalizePackages,
	parseDpkgFileList,
	parseInstalledSet,
	parseOsRelease,
	sanitizeLabel,
	selectMembers,
	Stats,
	validatePackageName
} from './apt';

const BASE = {packages: ['curl', 'jq'], osId: 'ubuntu', osVersion: '24.04', arch: 'amd64', extraKey: ''};

function statsFor(kind: 'file' | 'dir'): Stats {
	return {isDirectory: () => kind === 'dir'};
}

test('package input splits on whitespace, newlines and commas', () => {
	assert.deepEqual(normalizePackages(' jq\ncurl , ripgrep\t'), ['curl', 'jq', 'ripgrep']);
});

test('package input is deduped and sorted, so two orderings share one key', () => {
	assert.deepEqual(normalizePackages('jq curl jq'), ['curl', 'jq']);
	assert.equal(computeDigest({...BASE, packages: normalizePackages('jq curl')}), computeDigest({...BASE, packages: normalizePackages('curl jq')}));
});

test('an empty package input yields no packages', () => {
	assert.deepEqual(normalizePackages('   \n\t '), []);
});

test('an arch-qualified package name is valid', () => {
	validatePackageName('libc6:i386');
	validatePackageName('g++-13');
	validatePackageName('lib32z1');
});

test('a version pin is valid, which is how a caller stops the cache drifting', () => {
	validatePackageName('curl=7.81.0-1ubuntu1.15');
	validatePackageName('libc6:i386=2.35-0ubuntu3');
	assert.throws(() => validatePackageName('curl=7.8 --reinstall'), /not a valid apt package name/);
});

test('a package name carrying a shell argument is rejected', () => {
	assert.throws(() => validatePackageName('--reinstall'), /not a valid apt package name/);
	assert.throws(() => validatePackageName('curl; rm -rf /'), /not a valid apt package name/);
	assert.throws(() => validatePackageName('$(id)'), /not a valid apt package name/);
});

test('the digest changes with every keyed input', () => {
	const base = computeDigest(BASE);
	assert.notEqual(base, computeDigest({...BASE, packages: ['curl']}));
	assert.notEqual(base, computeDigest({...BASE, osVersion: '22.04'}));
	assert.notEqual(base, computeDigest({...BASE, osId: 'debian'}));
	assert.notEqual(base, computeDigest({...BASE, arch: 'arm64'}));
	assert.notEqual(base, computeDigest({...BASE, extraKey: 'v2'}));
});

test('the cache key names the platform and ends in the digest', () => {
	assert.equal(computeCacheKey(BASE), `cached-apt-v1-ubuntu-24.04-amd64-${computeDigest(BASE)}`);
});

test('a user key becomes a readable label in the key', () => {
	assert.equal(computeCacheKey({...BASE, extraKey: 'build tools/2'}), `cached-apt-v1-ubuntu-24.04-amd64-build-tools-2-${computeDigest({...BASE, extraKey: 'build tools/2'})}`);
});

test('a label is trimmed of separators and bounded in length', () => {
	assert.equal(sanitizeLabel('  ///weird key!!  '), 'weird-key');
	assert.equal(sanitizeLabel('x'.repeat(200)).length, 48);
});

test('only ii packages count as installed', () => {
	const set = parseInstalledSet(['ii\tcurl', 'rc\told-thing', 'iU\thalf-done', 'ii\tlibc6:i386'].join('\n'));
	assert.deepEqual([...set].sort(), ['curl', 'libc6:i386']);
});

test('the status column keeps its padding to three characters', () => {
	const set = parseInstalledSet(['ii \tadduser', 'rc \tgone', 'iHR\twedged', ''].join('\n'));
	assert.deepEqual([...set], ['adduser']);
});

test('a package diff reports only what appeared, sorted', () => {
	const before = parseInstalledSet('ii\tcurl');
	const after = parseInstalledSet(['ii\tcurl', 'ii\tjq', 'ii\tlibjq1'].join('\n'));
	assert.deepEqual(diffInstalled(before, after), ['jq', 'libjq1']);
});

test('a package that goes from rc to ii counts as newly installed', () => {
	const before = parseInstalledSet('rc\tjq');
	const after = parseInstalledSet('ii\tjq');
	assert.deepEqual(diffInstalled(before, after), ['jq']);
});

test('dpkg diversion notes are not paths', () => {
	const stdout = ['/.', '/usr', '/usr/bin/jq', 'package diverts others to: /bin.usr-is-merged', 'diverted by base-files to: /lib.usr-is-merged', ''].join('\n');
	assert.deepEqual(parseDpkgFileList(stdout), ['/usr', '/usr/bin/jq']);
});

test('a path listed by two packages appears once', () => {
	assert.deepEqual(parseDpkgFileList('/usr/share/x\n/usr/share/x\n'), ['/usr/share/x']);
});

test('directories are dropped and files keep a root-relative name', () => {
	const stats = new Map<string, Stats>([
		['/usr/bin', statsFor('dir')],
		['/usr/bin/jq', statsFor('file')],
		['/usr/lib/x86_64-linux-gnu/libjq.so.1', statsFor('file')]
	]);
	const selection = selectMembers([...stats.keys()], target => stats.get(target));
	assert.deepEqual(selection.members.map(member => member.relative), ['usr/bin/jq', 'usr/lib/x86_64-linux-gnu/libjq.so.1']);
	assert.equal(selection.skippedDirectories, 1);
});

test('a path dpkg lists but the image excluded is skipped, not archived', () => {
	const selection = selectMembers(['/usr/share/doc/jq/copyright', '/usr/bin/jq'], target => (target === '/usr/bin/jq' ? statsFor('file') : undefined));
	assert.deepEqual(selection.members.map(member => member.relative), ['usr/bin/jq']);
	assert.deepEqual(selection.skippedMissing, ['/usr/share/doc/jq/copyright']);
});

test('the tar file list is NUL separated, so a space or a dash in a name is literal', () => {
	const selection = selectMembers(['/opt/a b/-weird', '/usr/bin/jq'], () => statsFor('file'));
	assert.equal(encodeFileList(selection.members).toString('utf8'), 'opt/a b/-weird\0usr/bin/jq\0');
});

test('os-release fields are unquoted', () => {
	assert.deepEqual(parseOsRelease('NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n'), {id: 'ubuntu', versionId: '24.04'});
});

test('os-release without VERSION_ID fails loudly', () => {
	assert.throws(() => parseOsRelease('ID=ubuntu\n'), /cannot name this distribution/);
});
