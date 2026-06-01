import * as core from "@actions/core";
import { mkdirSync, chmodSync, writeFileSync } from "fs";
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
	core.info(`Downloading from buildhost: ${url}`);

	const res = await fetch(url);
	if (!res.ok) throw new Error(`Buildhost returned ${res.status} for ${url}`);

	writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
	chmodSync(destPath, 0o755);
	core.addPath(bindir);
	core.setOutput("path", destPath);
	core.info(`Installed ${binaryName} from buildhost`);
}

run().catch((error) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
