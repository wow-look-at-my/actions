import * as core from "@actions/core";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDefaultBranch, nextVersion, parseArgs, tagPrefix } from "./args";

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

/**
 * Whether this run owns the #latest pointer it is about to move.
 *
 * A prefix decides who is allowed to contend for one. `--include-branch`
 * gives a side branch its own `<name>/<branch>` prefix, so its pointer is
 * uncontended and it moves it freely. Without that flag every branch computes
 * the SAME unqualified prefix, and the pointer belongs to the default branch:
 * a side branch moving it serves that branch's tree to everyone installing
 * "latest", and two branches releasing at once race for the lock. The loser's
 * release then fails on "cannot lock ref" over content nothing was wrong with.
 *
 * On the default branch the same rule applies over time. Two pushes land close
 * together and the older run can finish last, walking the pointer backwards
 * onto a tree the branch has already left behind. So a run also checks that
 * the commit it was triggered for is still the tip.
 *
 * A remote that cannot be read leaves the tip unknown. The move goes ahead and
 * says so: a release that silently stops publishing #latest is worse than one
 * that occasionally re-runs a race.
 */
function ownsLatest(branch: string, sharedPrefix: boolean, staging: string): boolean {
	if (sharedPrefix && !isDefaultBranch(branch)) {
		core.info(`[${branch}] Shares the default branch's prefix; leaving #latest to it`);
		return false;
	}
	const sha = process.env.GITHUB_SHA ?? "";
	if (sha === "") return true;
	const tip = gitQuiet(["ls-remote", "origin", `refs/heads/${branch}`], staging).split(/\s+/)[0] ?? "";
	if (tip === "") {
		core.warning(`Could not read the tip of ${branch}; moving #latest without that check`);
		return true;
	}
	if (tip !== sha) {
		core.info(`[${branch}] ${tip.slice(0, 7)} superseded this run's ${sha.slice(0, 7)}; leaving #latest to it`);
		return false;
	}
	return true;
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));

	const branch = process.env.GITHUB_REF_NAME || git(["rev-parse", "--abbrev-ref", "HEAD"]);
	const prefix = tagPrefix(options.name, branch, options.includeBranch);

	// An explicit --version re-pins an existing number. Without one the number
	// is derived from what is already published.
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
	for (const tag of [numbered, latest]) {
		git(["tag", tag], staging);
		core.info(`Created tag: ${tag}`);
	}

	// GitHub applies one push in one ref transaction, and #latest is a pointer
	// every concurrent release moves. Pushed together, a run that lost that race
	// by milliseconds had its whole transaction rejected -- taking down the
	// numbered tag, which was unique to it and never contended. Split, the number
	// lands on its own; whichever run moves #latest last wins, which is what
	// "latest" means.
	if (autoVersion) {
		// A number is immutable: no force, so a stale tag listing fails loudly
		// rather than rewriting history.
		git(["push", "origin", `refs/tags/${numbered}`], staging);
	} else {
		git(["push", "--force", "origin", `refs/tags/${numbered}`], staging);
	}
	// The numbered tag belongs to this run and always lands. The pointer can be
	// shared, so it moves only for the run that owns it.
	if (ownsLatest(branch, prefix === options.name, staging)) {
		git(["push", "--force", "origin", `refs/tags/${latest}`], staging);
	}
	core.endGroup();
}

try {
	main();
} catch (error) {
	core.setFailed(error instanceof Error ? error.message : String(error));
}
