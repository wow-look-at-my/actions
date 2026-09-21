import * as cache from '@actions/cache';
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
	Manifest,
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

async function packArchive(archive: string, listFile: string): Promise<void> {
	await exec.exec('sudo', ['tar', '-cf', archive, '-C', '/', '--no-recursion', '--null', '-T', listFile]);
	await exec.exec('sudo', ['chmod', '0644', archive]);
}

async function main(): Promise<void> {
	if (process.platform !== 'linux') {
		throw new Error(`cached-apt needs a Linux runner with apt; this one is ${process.platform}`);
	}

	const packages = normalizePackages(core.getInput('packages', {required: true}));
	if (packages.length === 0) {
		throw new Error('the `packages` input is empty; name at least one apt package');
	}
	packages.forEach(validatePackageName);

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
	const archive = path.join(workDir, 'files.tar');
	const manifestPath = path.join(workDir, 'manifest.json');
	const cachePaths = [archive, manifestPath];

	const hit = await cache.restoreCache(cachePaths, key);
	if (hit) {
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
	await exec.exec('sudo', ['apt-get', 'update']);
	await exec.exec('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', ...packages], {
		env: {...process.env, DEBIAN_FRONTEND: 'noninteractive'}
	});
	// Every line past here runs only because apt exited 0. Nothing saves a cache
	// from a catch block or a post step, so a failed install leaves no entry.
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

	try {
		await cache.saveCache(cachePaths, key);
		core.info(`Saved ${selection.members.length} files under ${key}`);
	} catch (error) {
		// The packages are installed either way, so a lost save costs speed and
		// not correctness. It still gets reported.
		const message = error instanceof Error ? error.message : String(error);
		core.warning(`cached-apt installed the packages but could not save the cache: ${message}`);
	}
}

main().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
