import * as core from "@actions/core";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDefaultBranch, nextVersion, parseArgs } from "./args";

function git(args: string[], cwd?: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function gitQuiet(args: string[], cwd?: string): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

function served(prefix: string, staging: string): { sha: string; number: number } {
	const lines = git(["ls-remote", "origin", `refs/tags/${prefix}#*`], staging).split("\n");
	const refs = lines.filter((l) => l !== "").map((l) => l.split("\t") as [string, string]);
	const sha = refs.find(([, ref]) => ref === `refs/tags/${prefix}#latest`)?.[0] ?? "";
	if (sha === "") return { sha, number: -1 };
	const tags = refs.filter(([s]) => s === sha).map(([, ref]) => ref.replace(/^refs\/tags\//, ""));
	const highest = nextVersion(tags, prefix) - 1;
	return { sha, number: highest > 0 ? highest : -1 };
}

/** Moves #latest to this run's release when no higher number holds it.
 *
 *#latest belongs to the default branch. A side branch that moves it serves its
 *own tree under that name. On the default branch the order is the release
 *number, not the tip of the branch: a run that a later commit superseded is
 *still the newest release of a plugin that the later run took from a cache and
 *never published. The push is a compare-and-swap on the commit #latest named
 *when it was read. An older run that finishes last therefore cannot walk the
 *pointer backwards. */
function moveLatest(branch: string, prefix: string, version: number, staging: string): void {
	const latest = `${prefix}#latest`;
	if (!isDefaultBranch(branch)) {
		core.info(`[${branch}] #latest belongs to the default branch; leaving it alone`);
		return;
	}
	for (;;) {
		const now = served(prefix, staging);
		if (now.number > version) {
			core.info(`[${prefix}] ${latest} serves #${now.number}, newer than #${version}; leaving it`);
			return;
		}
		if (now.sha !== "" && now.number < 0) {
			core.warning(`[${prefix}] no numbered tag names the commit ${latest} serves; moving it to #${version}`);
		}
		try {
			git(["push", `--force-with-lease=refs/tags/${latest}:${now.sha}`, "origin", `refs/tags/${latest}`], staging);
			return;
		} catch (error) {
			// A lost lease moves the pointer under us. Anything else leaves it where it was, and is a real failure.
			if (served(prefix, staging).sha === now.sha) throw error;
			core.info(`[${prefix}] ${latest} moved while this run pushed; reading it again`);
		}
	}
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));

	const branch = process.env.GITHUB_REF_NAME || git(["rev-parse", "--abbrev-ref", "HEAD"]);
	const prefix = options.name;

	// An explicit --version re-pins an existing number. Without one the number is derived from what is already published.
	const autoVersion = options.version === "";
	let version = options.version;
	let latestTree = "";
	if (autoVersion) {
		gitQuiet(["fetch", "--tags", "--quiet"]);
		version = String(nextVersion(gitQuiet(["tag", "-l", `${prefix}#*`]).split("\n"), prefix));
		core.info(`Auto-incrementing to version ${version}`);
		// What #latest serves right now, so identical content can skip the release.
		latestTree = gitQuiet(["rev-parse", "--verify", "--quiet", `refs/tags/${prefix}#latest^{tree}`]);
	}

	const numbered = `${prefix}#${version}`;
	const latest = `${prefix}#latest`;
	const message = options.message || `Release ${numbered}`;

	core.startGroup(`[${numbered}] Prepare content`);
	const staging = fs.mkdtempSync(path.join(os.tmpdir(), "orphan-release-"));
	fs.cpSync(options.source, staging, { recursive: true });
	for (const pattern of options.exclude.split(/\s+/).filter((p) => p !== "")) {
		for (const match of fs.globSync(pattern, { cwd: staging })) {
			fs.rmSync(path.join(staging, match), { recursive: true, force: true });
		}
	}
	core.endGroup();

	core.startGroup(`[${numbered}] Create orphan commit`);
	git(["init", "-b", "master"], staging);
	git(["config", "user.name", "github-actions[bot]"], staging);
	git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"], staging);
	git(["add", "-A"], staging);
	git(["commit", "-m", message], staging);
	core.endGroup();

	// A tree OID is content-derived, so comparing across repositories is exact.
	// Without this every push mints a new number for an action nothing changed in.
	if (autoVersion && latestTree !== "" && git(["rev-parse", "HEAD^{tree}"], staging) === latestTree) {
		core.info(`[${prefix}] Content identical to ${latest}; skipping release (no new tag)`);
		return;
	}

	core.startGroup(`[${numbered}] Push tags`);
	const repository = process.env.GITHUB_REPOSITORY;
	if (repository) {
		const token = process.env.GITHUB_TOKEN ?? "";
		git(["remote", "add", "origin", `https://x-access-token:${token}@github.com/${repository}`], staging);
	}
	// The numbered tag belongs to this run and always lands.
	for (const tag of [numbered, latest]) {
		git(["tag", tag], staging);
		core.info(`Created tag: ${tag}`);
	}

	// GitHub applies one push in one ref transaction, and #latest is a pointer
	// every concurrent release moves.
	if (autoVersion) {
		// A number is immutable: no force, so a stale tag listing fails loudly rather than rewriting history.
		git(["push", "origin", `refs/tags/${numbered}`], staging);
	} else {
		git(["push", "--force", "origin", `refs/tags/${numbered}`], staging);
	}
	moveLatest(branch, prefix, Number(version), staging);
	core.endGroup();
}

try {
	main();
} catch (error) {
	core.setFailed(error instanceof Error ? error.message : String(error));
}
