import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { mkdirSync, chmodSync, renameSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BUILDHOST_BASE = "https://pazer.build";

const archMap: Record<string, string> = {
	X64: "amd64",
	ARM64: "arm64",
};

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
	const project = name || repo.split("/").pop()!;
	const binaryName = project + ext;

	const bindir = join(homedir(), ".local", "bin");
	mkdirSync(bindir, { recursive: true });
	const destPath = join(bindir, binaryName);

	// dl service lives at dl.{domain}/{project}?os=...&arch=...[&v=...]
	const base = new URL(BUILDHOST_BASE);
	const params = new URLSearchParams({ os, arch });
	if (version !== "latest") params.set("v", version);
	const url = `${base.protocol}//dl.${base.host}/${project}?${params}`;
	core.info(`Trying buildhost: ${url}`);

	let got = false;
	try {
		const res = await fetch(url);
		if (res.ok) {
			writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
			got = true;
		} else {
			core.info(`Buildhost returned ${res.status}, falling back to GitHub Releases`);
		}
	} catch (err) {
		core.info(`Buildhost unreachable, falling back to GitHub Releases`);
	}

	if (!got) {
		const token = core.getInput("token", { required: true });
		if (!token) {
			throw new Error("A GitHub token is required for the GitHub Releases fallback.");
		}
		process.env.GH_TOKEN = token;

		const suffix = `_${os}_${arch}${ext}`;
		const pattern = `${name || "*"}${suffix}`;
		const ghArgs = ["release", "download"];
		if (version !== "latest") ghArgs.push(version);
		ghArgs.push("--repo", repo, "--pattern", pattern, "--dir", bindir, "--clobber");

		await exec.exec("gh", ghArgs);

		const downloaded = readdirSync(bindir).filter((f) => f.endsWith(suffix));
		if (downloaded.length === 0) throw new Error(`No files matching ${pattern} after download`);
		if (downloaded.length > 1) throw new Error(`Multiple files matching ${pattern}: ${downloaded.join(", ")}`);

		const asset = downloaded[0];
		const finalName = asset.slice(0, -suffix.length) + ext;
		const finalPath = join(bindir, finalName);
		renameSync(join(bindir, asset), finalPath);
		chmodSync(finalPath, 0o755);
		core.addPath(bindir);
		core.setOutput("path", finalPath);
		core.info(`Installed ${finalName} from GitHub Releases`);
		return;
	}

	chmodSync(destPath, 0o755);
	core.addPath(bindir);
	core.setOutput("path", destPath);
	core.info(`Installed ${binaryName} from buildhost`);
}

run().catch((error) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
