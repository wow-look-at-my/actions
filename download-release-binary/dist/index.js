import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { mkdirSync, chmodSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
const archMap = {
    X64: "amd64",
    ARM64: "arm64",
};
async function run() {
    const repo = core.getInput("repo", { required: true });
    const name = core.getInput("name") || "*";
    const version = core.getInput("version") || "latest";
    const runnerOS = process.env.RUNNER_OS;
    const runnerArch = process.env.RUNNER_ARCH;
    const os = runnerOS === "macOS" ? "darwin" : runnerOS.toLowerCase();
    const arch = archMap[runnerArch];
    if (!arch)
        throw new Error(`Unsupported arch: ${runnerArch}`);
    const ext = runnerOS === "Windows" ? ".exe" : "";
    const suffix = `_${os}_${arch}${ext}`;
    const pattern = `${name}${suffix}`;
    const bindir = join(homedir(), ".local", "bin");
    mkdirSync(bindir, { recursive: true });
    await exec.exec("gh", [
        "release",
        "download",
        version,
        "--repo",
        repo,
        "--pattern",
        pattern,
        "--dir",
        bindir,
        "--clobber",
    ]);
    // Find downloaded files matching the pattern
    const downloaded = readdirSync(bindir).filter((f) => f.endsWith(suffix));
    if (downloaded.length === 0)
        throw new Error(`No files matching ${pattern} after download`);
    if (downloaded.length > 1)
        throw new Error(`Multiple files matching ${pattern}: ${downloaded.join(", ")}`);
    const asset = downloaded[0];
    const binaryName = asset.slice(0, -suffix.length) + ext;
    const destPath = join(bindir, binaryName);
    renameSync(join(bindir, asset), destPath);
    chmodSync(destPath, 0o755);
    core.addPath(bindir);
    core.setOutput("path", destPath);
    core.info(`Installed ${binaryName} to ${bindir}`);
}
run().catch((error) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
