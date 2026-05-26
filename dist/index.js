"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const BUILDHOST_BASE = "https://pazer.build";
const archMap = {
    X64: "amd64",
    ARM64: "arm64",
};
async function run() {
    const repo = core.getInput("repo", { required: true });
    const name = core.getInput("name") || "";
    const version = core.getInput("version") || "latest";
    const runnerOS = process.env.RUNNER_OS;
    const runnerArch = process.env.RUNNER_ARCH;
    const os = runnerOS === "macOS" ? "darwin" : runnerOS.toLowerCase();
    const arch = archMap[runnerArch];
    if (!arch)
        throw new Error(`Unsupported arch: ${runnerArch}`);
    const ext = runnerOS === "Windows" ? ".exe" : "";
    const project = name || repo.split("/").pop();
    const binaryName = project + ext;
    const bindir = (0, path_1.join)((0, os_1.homedir)(), ".local", "bin");
    (0, fs_1.mkdirSync)(bindir, { recursive: true });
    const destPath = (0, path_1.join)(bindir, binaryName);
    const url = `${BUILDHOST_BASE}/dl/${project}/${version}/${os}/${arch}`;
    core.info(`Trying buildhost: ${url}`);
    let got = false;
    try {
        const res = await fetch(url);
        if (res.ok) {
            (0, fs_1.writeFileSync)(destPath, Buffer.from(await res.arrayBuffer()));
            got = true;
        }
        else {
            core.info(`Buildhost returned ${res.status}, falling back to GitHub Releases`);
        }
    }
    catch (err) {
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
        if (version !== "latest")
            ghArgs.push(version);
        ghArgs.push("--repo", repo, "--pattern", pattern, "--dir", bindir, "--clobber");
        await exec.exec("gh", ghArgs);
        const downloaded = (0, fs_1.readdirSync)(bindir).filter((f) => f.endsWith(suffix));
        if (downloaded.length === 0)
            throw new Error(`No files matching ${pattern} after download`);
        if (downloaded.length > 1)
            throw new Error(`Multiple files matching ${pattern}: ${downloaded.join(", ")}`);
        const asset = downloaded[0];
        const finalName = asset.slice(0, -suffix.length) + ext;
        const finalPath = (0, path_1.join)(bindir, finalName);
        (0, fs_1.renameSync)((0, path_1.join)(bindir, asset), finalPath);
        (0, fs_1.chmodSync)(finalPath, 0o755);
        core.addPath(bindir);
        core.setOutput("path", finalPath);
        core.info(`Installed ${finalName} from GitHub Releases`);
        return;
    }
    (0, fs_1.chmodSync)(destPath, 0o755);
    core.addPath(bindir);
    core.setOutput("path", destPath);
    core.info(`Installed ${binaryName} from buildhost`);
}
run().catch((error) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
