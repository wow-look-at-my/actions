import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { mkdirSync, chmodSync, renameSync, readdirSync, createWriteStream } from "fs";
import { join } from "path";
import { homedir } from "os";
import { get as httpsGet } from "https";
import { IncomingMessage } from "http";

const BUILDHOST_BASE = "https://pazer.build";

const archMap: Record<string, string> = {
	X64: "amd64",
	ARM64: "arm64",
};

function followRedirects(url: string): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		httpsGet(url, (res) => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				followRedirects(res.headers.location).then(resolve, reject);
			} else {
				resolve(res);
			}
		}).on("error", reject);
	});
}

async function tryBuildhost(project: string, version: string, os: string, arch: string, destPath: string): Promise<boolean> {
	const url = `${BUILDHOST_BASE}/dl/${project}/${version}/${os}/${arch}`;
	core.info(`Trying buildhost: ${url}`);

	try {
		const res = await followRedirects(url);
		if (res.statusCode !== 200) {
			core.info(`Buildhost returned ${res.statusCode}, falling back to GitHub Releases`);
			res.resume();
			return false;
		}

		await new Promise<void>((resolve, reject) => {
			const file = createWriteStream(destPath);
			res.pipe(file);
			file.on("finish", () => { file.close(); resolve(); });
			file.on("error", reject);
			res.on("error", reject);
		});

		return true;
	} catch (err) {
		core.info(`Buildhost failed: ${err instanceof Error ? err.message : String(err)}, falling back to GitHub Releases`);
		return false;
	}
}

async function downloadFromGitHub(repo: string, version: string, pattern: string, bindir: string, suffix: string, ext: string): Promise<string> {
	const ghArgs = ["release", "download"];
	if (version !== "latest") ghArgs.push(version);
	ghArgs.push("--repo", repo, "--pattern", pattern, "--dir", bindir, "--clobber");

	await exec.exec("gh", ghArgs);

	const downloaded = readdirSync(bindir).filter((f) => f.endsWith(suffix));
	if (downloaded.length === 0) throw new Error(`No files matching ${pattern} after download`);
	if (downloaded.length > 1) throw new Error(`Multiple files matching ${pattern}: ${downloaded.join(", ")}`);

	const asset = downloaded[0];
	const binaryName = asset.slice(0, -suffix.length) + ext;
	const destPath = join(bindir, binaryName);

	renameSync(join(bindir, asset), destPath);
	return destPath;
}

async function run(): Promise<void> {
	const repo = core.getInput("repo", { required: true });
	const name = core.getInput("name") || "";
	const version = core.getInput("version") || "latest";

	const runnerOS = process.env.RUNNER_OS!;
	const runnerArch = process.env.RUNNER_ARCH!;

	const os = runnerOS === "macOS" ? "darwin" : runnerOS.toLowerCase();
	const arch = archMap[runnerArch];
	if (!arch) throw new Error(`Unsupported arch: ${runnerArch}`);

	const ext = runnerOS === "Windows" ? ".exe" : "";

	const bindir = join(homedir(), ".local", "bin");
	mkdirSync(bindir, { recursive: true });

	const project = name || repo.split("/").pop()!;
	const binaryName = project + ext;
	const destPath = join(bindir, binaryName);

	const got = await tryBuildhost(project, version, os, arch, destPath);

	if (!got) {
		const token = core.getInput("token", { required: true });
		if (!token) {
			throw new Error("A GitHub token is required. Pass `token:` (e.g. github.token or a PAT with repo scope).");
		}
		process.env.GH_TOKEN = token;

		const suffix = `_${os}_${arch}${ext}`;
		const pattern = `${name || "*"}${suffix}`;
		const ghDest = await downloadFromGitHub(repo, version, pattern, bindir, suffix, ext);
		chmodSync(ghDest, 0o755);
		core.addPath(bindir);
		core.setOutput("path", ghDest);
		core.info(`Installed ${binaryName} from GitHub Releases to ${bindir}`);
		return;
	}

	chmodSync(destPath, 0o755);
	core.addPath(bindir);
	core.setOutput("path", destPath);
	core.info(`Installed ${binaryName} from buildhost to ${bindir}`);
}

run().catch((error) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
