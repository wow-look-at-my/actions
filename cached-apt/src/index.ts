import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	CACHE_VERSION,
	computeCacheKey,
	computeDigest,
	diffInstalled,
	encodeFileList,
	keepReachableMirrors,
	Manifest,
	parseMirrorList,
	normalizePackages,
	parseDpkgFileList,
	parseInstalledSet,
	parseOsRelease,
	selectMembers,
	validatePackageName
} from './apt';

async function capture(command: string, args: string[]): Promise<string> {
	let stdout = '';
	await exec.exec(command, args, {
		silent: true,
		listeners: {stdout: (data: Buffer) => (stdout += data.toString())}
	});
	return stdout;
}

async function installedSet(): Promise<Set<string>> {
	return parseInstalledSet(await capture('dpkg-query', ['-W', '-f', '${db:Status-Abbrev}\\t${binary:Package}\\n']));
}

function lstatOrUndefined(target: string): fs.Stats | undefined {
	try {
		return fs.lstatSync(target);
	} catch {
		return undefined;
	}
}

// Restoring into `/` bypasses dpkg entirely, so nothing else re-links the
// shared-library cache.
async function extractArchive(archive: string): Promise<void> {
	await exec.exec('sudo', ['tar', '-xf', archive, '-C', '/', '--same-owner', '--same-permissions', '--overwrite']);
	await exec.exec('sudo', ['ldconfig']);
}

const MIRROR_LIST = '/etc/apt/apt-mirrors.txt';
const MIRROR_PROBE_MS = 15000;
// A healthy `apt-get update` takes seconds; past this it has stalled.
const APT_UPDATE_SECONDS = 300;

async function answers(url: string): Promise<boolean> {
	try {
		await fetch(url, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(MIRROR_PROBE_MS)});
		return true;
	} catch (error) {
		core.info(`apt mirror ${url} did not answer: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

// GitHub's Ubuntu images point apt at a `mirror+file:` list. Apt fails over
// and then never finishes, so a mirror that does not answer an HTTP request
// is taken out of the list first. Do this when the first mirror stops
// answering.
async function dropUnreachableMirrors(): Promise<void> {
	if (!fs.existsSync(MIRROR_LIST)) {
		return;
	}
	const lines = parseMirrorList(fs.readFileSync(MIRROR_LIST, 'utf8'));
	const urls = lines.flatMap(line => (line.url === undefined ? [] : [line.url]));
	const results = await Promise.all(urls.map(async url => [url, await answers(url)] as const));
	const selection = keepReachableMirrors(lines, new Set(results.filter(([, ok]) => ok).map(([url]) => url)));
	if (selection.dropped.length === 0) {
		return;
	}
	await exec.exec('sudo', ['tee', MIRROR_LIST], {input: Buffer.from(selection.content, 'utf8'), silent: true});
	core.warning(`cached-apt removed apt mirrors that did not answer within ${MIRROR_PROBE_MS / 1000}s: ${selection.dropped.join(', ')}. apt now uses ${selection.kept.join(', ')}.`);
}

async function packArchive(archive: string, listFile: string): Promise<void> {
	await exec.exec('sudo', ['tar', '-cf', archive, '-C', '/', '--no-recursion', '--null', '-T', listFile]);
	await exec.exec('sudo', ['chmod', '0644', archive]);
}

// The composite runs this twice, around buildhost's cache restore and save.
// `plan` names the key and the directory the cache holds. `apply` restores the
// files from a hit, or installs with apt and packs the files for the save.
async function plan(): Promise<void> {
	// A no-op rather than a failure, so a cross-platform matrix calls this
	// unconditionally. It is announced, never silent: a caller that needed the
	// packages finds out here instead of at the compile that misses them.
	if (process.platform !== 'linux') {
		core.setOutput('skipped', 'true');
		core.setOutput('cache-hit', 'false');
		core.setOutput('installed-packages', '');
		core.notice(`cached-apt installed nothing: apt needs Linux and this runner is ${process.platform}. Install these packages another way here.`);
		return;
	}
	core.setOutput('skipped', 'false');

	const packages = requestedPackages();
	const extraKey = core.getInput('key');
	const osRelease = parseOsRelease(fs.readFileSync('/etc/os-release', 'utf8'));
	const arch = (await capture('dpkg', ['--print-architecture'])).trim();
	if (arch === '') {
		throw new Error('`dpkg --print-architecture` printed nothing, so the cache key cannot name this architecture');
	}

	const keyParts = {packages, osId: osRelease.id, osVersion: osRelease.versionId, arch, extraKey};
	const key = computeCacheKey(keyParts);
	const digest = computeDigest(keyParts);
	core.info(`Cache key: ${key}`);

	const workDir = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `cached-apt-${digest}`);
	fs.mkdirSync(workDir, {recursive: true});
	core.setOutput('key', key);
	core.setOutput('work-dir', workDir);
}

function requestedPackages(): string[] {
	const packages = normalizePackages(core.getInput('packages', {required: true}));
	if (packages.length === 0) {
		throw new Error('the `packages` input is empty; name at least one apt package');
	}
	packages.forEach(validatePackageName);
	return packages;
}

async function apply(): Promise<void> {
	const packages = requestedPackages();
	const key = requiredEnv('CACHED_APT_KEY');
	const workDir = requiredEnv('CACHED_APT_WORK_DIR');
	const archive = path.join(workDir, 'files.tar');
	const manifestPath = path.join(workDir, 'manifest.json');
	core.setOutput('save', 'false');

	if (requiredEnv('CACHED_APT_HIT') === 'true') {
		await extractArchive(archive);
		const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		core.setOutput('cache-hit', 'true');
		core.setOutput('installed-packages', manifest.installed.join(' '));
		core.info(`Restored ${manifest.fileCount} files for: ${manifest.installed.join(' ')}`);
		core.notice(
			`cached-apt restored ${manifest.installed.length} packages as plain files. dpkg does not record them as installed, and no maintainer script ran.`
		);
		return;
	}

	core.setOutput('cache-hit', 'false');
	core.info('Cache miss; installing with apt');

	const before = await installedSet();
	await dropUnreachableMirrors();
	await exec.exec('sudo', ['timeout', '-k', '10', String(APT_UPDATE_SECONDS), 'apt-get', 'update']);
	await exec.exec('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', ...packages], {
		env: {...process.env, DEBIAN_FRONTEND: 'noninteractive'}
	});
	// Every line past here runs only because apt exited 0.
	const after = await installedSet();
	const newlyInstalled = diffInstalled(before, after);
	core.setOutput('installed-packages', newlyInstalled.join(' '));

	if (newlyInstalled.length === 0) {
		core.notice(
			`cached-apt saved no cache: ${packages.join(' ')} were already installed on this image, so there are no new files to capture.`
		);
		return;
	}

	const declared = parseDpkgFileList(await capture('dpkg-query', ['-L', ...newlyInstalled]));
	const selection = selectMembers(declared, lstatOrUndefined);
	if (selection.members.length === 0) {
		throw new Error(`apt installed ${newlyInstalled.join(' ')} but dpkg lists no files for them`);
	}
	core.info(
		`Capturing ${selection.members.length} files from ${newlyInstalled.length} packages ` +
			`(skipped ${selection.skippedDirectories} directories, ${selection.skippedMissing.length} absent paths)`
	);

	const listFile = path.join(workDir, 'files.nul');
	fs.writeFileSync(listFile, encodeFileList(selection.members));
	await packArchive(archive, listFile);

	const manifest: Manifest = {
		version: CACHE_VERSION,
		key,
		packages,
		installed: newlyInstalled,
		fileCount: selection.members.length
	};
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	core.setOutput('save', 'true');
	core.info(`Packed ${selection.members.length} files for the save under ${key}`);
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === '') {
		throw new Error(`${name} is not set: the cached-apt composite sets it from its plan and restore steps`);
	}
	return value;
}

async function main(): Promise<void> {
	const mode = process.argv[2];
	if (mode === 'plan') return plan();
	if (mode === 'apply') return apply();
	throw new Error(`unknown mode '${mode}': want plan or apply`);
}

main().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
