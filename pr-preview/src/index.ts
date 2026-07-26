import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── helpers ───────────────────────────────────────────────────────────────────

function env(name: string): string {
  return process.env[name] || "";
}

// Mirrors @actions/core getInput(): the runner exports each `with:` key as
// INPUT_<NAME>, uppercased with spaces (not hyphens) turned into underscores.
function input(name: string): string {
  return env(`INPUT_${name.replace(/ /g, "_").toUpperCase()}`);
}

function appendToFile(filePath: string, content: string): void {
  fs.appendFileSync(filePath, content);
}

function writeEnvAndOutput(
  vars: Record<string, string>,
  envFile: string,
  outputFile: string,
): void {
  const lines = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  appendToFile(envFile, lines + "\n");
  appendToFile(outputFile, lines + "\n");
}

async function githubApi(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const token = input("token");
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const opts: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(`${apiUrl}${endpoint}`, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${method} ${endpoint}: ${resp.status} ${text}`);
  }
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return resp.json();
  return resp.text();
}

// ── inject-cache-bust ─────────────────────────────────────────────────────────

const CACHE_BUST_SCRIPT = `<script>(function(){var q=location.search;if(!q)return;document.addEventListener("click",function(e){var a=e.target.closest("a");if(!a)return;var h=a.getAttribute("href");if(!h||h.startsWith("#")||/^[a-z][a-z0-9+.-]*:/i.test(h))return;try{var u=new URL(h,location.href);if(u.origin!==location.origin)return;if(!u.search)u.search=q;a.href=u.pathname+u.search+u.hash}catch(e){}})})();</script>`;

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findHtmlFiles(full));
    else if (entry.name.endsWith(".html") || entry.name.endsWith(".htm"))
      results.push(full);
  }
  return results;
}

function injectCacheBustScript(targetDir: string): void {
  const htmlFiles = findHtmlFiles(targetDir);
  for (const file of htmlFiles) {
    let content = fs.readFileSync(file, "utf8");
    if (content.includes("</body>"))
      content = content.replace("</body>", CACHE_BUST_SCRIPT + "</body>");
    else if (content.includes("</html>"))
      content = content.replace("</html>", CACHE_BUST_SCRIPT + "</html>");
    else content += CACHE_BUST_SCRIPT;
    fs.writeFileSync(file, content);
  }
  if (htmlFiles.length > 0)
    console.log(`Injected cache-bust script into ${htmlFiles.length} HTML file(s)`);
}

// ── setup ─────────────────────────────────────────────────────────────────────

function calculatePagesBaseUrl(repo: string): string {
  const [owner, repoName] = repo.split("/");
  if (repoName === `${owner}.github.io`) return `${owner}.github.io`;
  return `${owner}.github.io/${repoName}`;
}

function normalisePath(p: string): string {
  return p
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");
}

function removePrefixPath(basePath: string, originalPath: string): string {
  const normBase = normalisePath(basePath);
  const normOriginal = normalisePath(originalPath);
  if (!normBase) return normOriginal;
  if (normOriginal.startsWith(normBase + "/"))
    return normOriginal.slice(normBase.length + 1);
  return normOriginal;
}

function determineAutoAction(eventName: string, eventPath: string): string {
  if (eventName === "push") {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const defaultBranch = event.repository?.default_branch;
    const ref = env("GITHUB_REF");
    if (defaultBranch && ref === `refs/heads/${defaultBranch}`) return "deploy";
    console.error(`Push to non-default branch (${ref}), skipping`);
    return "none";
  }
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    console.error(`unknown event ${eventName}; no action to take`);
    return "none";
  }
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const action: string = event.action;
  console.error(`event_type is ${action}`);
  switch (action) {
    case "opened":
    case "reopened":
    case "synchronize":
      return "deploy";
    case "closed":
      return "remove";
    default:
      console.error(`unknown event type ${action}; no action to take`);
      return "none";
  }
}

function cmdSetup(): void {
  const inputAction = input("action") || "auto";
  const umbrellaDir = input("umbrella-dir") || "pr-preview";
  const pagesBaseUrlInput = input("pages-base-url");
  const pagesBasePath = input("pages-base-path");
  const prNumber = input("pr-number");
  const actionRef = input("action-ref") || "unknown";
  const eventName = env("GITHUB_EVENT_NAME");
  const eventPath = env("GITHUB_EVENT_PATH");
  const repository = env("GITHUB_REPOSITORY");
  const envFile = env("GITHUB_ENV");
  const outputFile = env("GITHUB_OUTPUT");

  const pagesBaseUrl = pagesBaseUrlInput || calculatePagesBaseUrl(repository);
  const isPrEvent =
    eventName === "pull_request" || eventName === "pull_request_target";
  const previewFilePath = isPrEvent ? `${umbrellaDir}/pr-${prNumber}` : "";

  let previewUrlPath = "";
  if (previewFilePath) {
    previewUrlPath = removePrefixPath(pagesBasePath, previewFilePath);
    if (
      pagesBasePath &&
      removePrefixPath("", previewFilePath) === previewUrlPath
    ) {
      console.warn(
        `::warning title=pages-base-path doesn't match::The pages-base-path directory (${pagesBasePath}) does not contain umbrella-dir (${umbrellaDir}). pages-base-path has been ignored.`,
      );
      previewUrlPath = previewFilePath;
    }
  }

  let deploymentAction = inputAction;
  if (deploymentAction === "auto") {
    console.error("Determining auto action");
    deploymentAction = determineAutoAction(eventName, eventPath);
    console.error(`Auto action is ${deploymentAction}`);
  }

  const basePreviewUrl = previewUrlPath
    ? `https://${pagesBaseUrl}/${previewUrlPath}/`
    : `https://${pagesBaseUrl}/`;

  let shortSha = "";
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const headSha: string =
      event.pull_request?.head?.sha || env("GITHUB_SHA") || "";
    shortSha = headSha.slice(0, 7);
  } catch {
    shortSha = (env("GITHUB_SHA") || "").slice(0, 7);
  }

  const previewUrl = shortSha
    ? `${basePreviewUrl}?v=${shortSha}`
    : basePreviewUrl;

  const actionStartTimestamp = Math.floor(Date.now() / 1000).toString();
  const actionStartTime = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");

  writeEnvAndOutput(
    {
      deployment_action: deploymentAction,
      preview_file_path: previewFilePath,
      pages_base_url: pagesBaseUrl,
      preview_url_path: previewUrlPath,
      preview_url: previewUrl,
      short_sha: shortSha,
      action_version: actionRef,
      action_start_time: actionStartTime,
      action_start_timestamp: actionStartTimestamp,
    },
    envFile,
    outputFile,
  );

  console.log(`Action: ${deploymentAction}`);
  console.log(`Preview URL: ${previewUrl}`);
}

// ── git-update ────────────────────────────────────────────────────────────────

// ── shared dirs ───────────────────────────────────────────────────────────────
// Directories kept once at the root of the preview branch instead of duplicated
// into every PR subdirectory. Built for npm-registry-style previews where many
// previews reference the same tarballs.

function parseSharedDirs(): string[] {
  return input("shared-dirs")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Additive: existing files of the same name are overwritten, others preserved.
function mergeSharedDir(
  sourceBase: string,
  destRoot: string,
  sharedName: string,
): void {
  const src = path.join(sourceBase, sharedName);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return;
  const dest = path.join(destRoot, sharedName);
  fs.mkdirSync(dest, { recursive: true });
  run(`cp -r "${src}"/. "${dest}/"`);
}

// Drop from the staging area so the per-PR copy doesn't duplicate it.
function removeFromSource(sourceBase: string, dirName: string): void {
  const p = path.join(sourceBase, dirName);
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
}

// Collect tarball filenames referenced by any packument in a directory.
function collectReferencedTarballs(packumentDir: string): Set<string> {
  const refs = new Set<string>();
  if (!fs.existsSync(packumentDir)) return refs;

  for (const entry of fs.readdirSync(packumentDir)) {
    if (entry.startsWith(".")) continue;
    const fullPath = path.join(packumentDir, entry);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) continue;

    try {
      const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (!data.versions || typeof data.versions !== "object") continue;
      for (const ver of Object.values(data.versions)) {
        const url = (ver as { dist?: { tarball?: string } }).dist?.tarball;
        if (url) refs.add(path.basename(url));
      }
    } catch {
      // Not a packument -- skip.
    }
  }
  return refs;
}

// Delete shared-dir files no longer referenced by any remaining packument.
function gcSharedDirs(
  ghPagesDir: string,
  sharedDirs: string[],
  umbrellaDir: string,
): void {
  if (sharedDirs.length === 0) return;

  const allRefs = new Set<string>();
  for (const name of collectReferencedTarballs(ghPagesDir)) allRefs.add(name);

  const umbrella = path.join(ghPagesDir, umbrellaDir);
  if (fs.existsSync(umbrella)) {
    for (const prDir of fs.readdirSync(umbrella)) {
      const prPath = path.join(umbrella, prDir);
      if (!fs.statSync(prPath).isDirectory()) continue;
      for (const name of collectReferencedTarballs(prPath)) allRefs.add(name);
    }
  }

  for (const sharedName of sharedDirs) {
    const sharedPath = path.join(ghPagesDir, sharedName);
    if (!fs.existsSync(sharedPath) || !fs.statSync(sharedPath).isDirectory())
      continue;

    let removed = 0;
    for (const file of fs.readdirSync(sharedPath)) {
      if (!allRefs.has(file)) {
        fs.rmSync(path.join(sharedPath, file), { recursive: true });
        removed++;
      }
    }
    if (removed > 0)
      console.log(
        `GC: removed ${removed} unreferenced file(s) from ${sharedName}/`,
      );
  }
}

async function isPrOpen(prNumber: string): Promise<boolean> {
  const repo = env("GITHUB_REPOSITORY");
  try {
    const pr = (await githubApi("GET", `/repos/${repo}/pulls/${prNumber}`)) as {
      state: string;
    };
    return pr.state === "open";
  } catch {
    // On an API failure, keep the preview rather than deleting it.
    return true;
  }
}

// Sweep previews whose PR has closed, then GC what they were holding onto.
async function cleanupClosedPreviews(
  ghPagesDir: string,
  umbrellaDir: string,
  sharedDirs: string[],
): Promise<void> {
  const umbrella = path.join(ghPagesDir, umbrellaDir);
  if (!fs.existsSync(umbrella)) return;

  let removedAny = false;
  for (const entry of fs.readdirSync(umbrella)) {
    const match = entry.match(/^pr-(\d+)$/);
    if (!match) continue;
    if (await isPrOpen(match[1])) continue;

    console.log(`Removing stale preview for PR #${match[1]}`);
    fs.rmSync(path.join(umbrella, entry), { recursive: true });
    removedAny = true;
  }

  if (removedAny) gcSharedDirs(ghPagesDir, sharedDirs, umbrellaDir);
}

function run(cmd: string, cwd?: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

async function cmdGitUpdate(mode: "deploy" | "remove"): Promise<void> {
  const branch = input("branch");
  const token = input("token");
  const repo = env("GITHUB_REPOSITORY");
  const targetPath = input("target-path");
  const commitMessage = input("commit-message");
  const sourceDir = input("source-dir");
  const workspace = env("GITHUB_WORKSPACE");
  const runnerTemp = env("RUNNER_TEMP") || path.join(workspace, "..");
  const dir = path.join(runnerTemp, "__gh-pages-content");

  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });

  try {
    run(
      `git clone --depth 1 --branch "${branch}" "https://x-access-token:${token}@github.com/${repo}.git" "${dir}"`,
    );
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    run("git init", dir);
    run(`git checkout --orphan "${branch}"`, dir);
    run(
      `git remote add origin "https://x-access-token:${token}@github.com/${repo}.git"`,
      dir,
    );
  }

  const sharedDirs = parseSharedDirs();
  const umbrellaDir = input("umbrella-dir") || "pr-preview";
  const sourcePath = path.join(workspace, sourceDir);

  if (mode === "deploy") {
    if (targetPath === "") {
      // Root deployment: keep .git, the umbrella, and any shared dirs.
      const preserveSet = new Set([".git", umbrellaDir, ...sharedDirs]);
      for (const entry of fs.readdirSync(dir)) {
        if (preserveSet.has(entry)) continue;
        fs.rmSync(path.join(dir, entry), { recursive: true });
      }
      // Merge shared dirs to the root, then drop them from the source so the
      // bulk copy below cannot overwrite what was just merged.
      for (const sd of sharedDirs) mergeSharedDir(sourcePath, dir, sd);
      for (const sd of sharedDirs) removeFromSource(sourcePath, sd);

      run(`cp -r "${sourcePath}"/. "${dir}/"`);
      injectCacheBustScript(dir);
      const shortSha = env("short_sha");
      if (shortSha)
        fs.writeFileSync(path.join(dir, "version.txt"), shortSha + "\n");
    } else {
      const target = path.join(dir, targetPath);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
      fs.mkdirSync(target, { recursive: true });

      // Shared dirs live at the root, never inside the per-PR directory.
      for (const sd of sharedDirs) mergeSharedDir(sourcePath, dir, sd);
      for (const sd of sharedDirs) removeFromSource(sourcePath, sd);

      run(`cp -r "${sourcePath}"/. "${target}/"`);
      injectCacheBustScript(target);
      const shortSha = env("short_sha");
      if (shortSha)
        fs.writeFileSync(path.join(target, "version.txt"), shortSha + "\n");
    }
    await cleanupClosedPreviews(dir, umbrellaDir, sharedDirs);
  } else {
    const target = path.join(dir, targetPath);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
    // This preview may have been the last referencing some shared files.
    gcSharedDirs(dir, sharedDirs, umbrellaDir);
  }

  run('git config user.name "pr-preview-action[bot]"', dir);
  run(
    'git config user.email "pr-preview-action[bot]@users.noreply.github.com"',
    dir,
  );
  run("git add -A", dir);
  try {
    execSync("git diff --cached --quiet", { cwd: dir });
    console.log("No changes to commit.");
  } catch {
    run(`git commit -m "${commitMessage}"`, dir);
  }
  run(`git push -u origin "${branch}"`, dir);
  fs.rmSync(path.join(dir, ".git"), { recursive: true });
}

// ── comment ───────────────────────────────────────────────────────────────────

const COMMENT_HEADER = "<!-- Sticky Pull Request Comment pr-preview -->";

function generateDeployComment(): string {
  const actionVersion = env("action_version");
  const previewUrl = env("preview_url");
  const previewBranch = input("preview-branch") || "gh-pages";
  const serverUrl = env("GITHUB_SERVER_URL") || "https://github.com";
  const repository = env("GITHUB_REPOSITORY");
  const actionStartTime = env("action_start_time");
  return `${COMMENT_HEADER}
[PR Preview](https://github.com/wow-look-at-my/actions) ${actionVersion}
:---:
| :rocket: View preview at <br> ${previewUrl} <br><br>
| <h6>Built to branch [\`${previewBranch}\`](${serverUrl}/${repository}/tree/${previewBranch}) at ${actionStartTime}. <br> Preview is ready! <br><br> </h6>`;
}

function generateRemoveComment(): string {
  const actionVersion = env("action_version");
  const actionStartTime = env("action_start_time");
  return `${COMMENT_HEADER}
[PR Preview](https://github.com/wow-look-at-my/actions) ${actionVersion}
:---:
Preview removed because the pull request was closed.
${actionStartTime}`;
}

async function cmdComment(): Promise<void> {
  const deploymentAction = env("deployment_action");
  const commentEnabled = input("comment");
  const prNumber = input("pr-number");
  const repo = env("GITHUB_REPOSITORY");
  const dryRun = env("DRY_RUN") === "true";

  if (commentEnabled !== "true") {
    console.log("Comments disabled, skipping");
    return;
  }

  let body: string;
  if (deploymentAction === "deploy") body = generateDeployComment();
  else if (deploymentAction === "remove") body = generateRemoveComment();
  else {
    console.log(`No comment for action: ${deploymentAction}`);
    return;
  }

  if (dryRun) {
    process.stdout.write(body);
    return;
  }

  type Comment = { id: number; body?: string };
  const comments = (await githubApi(
    "GET",
    `/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
  )) as Comment[];
  const existing = comments.find((c) => c.body?.includes(COMMENT_HEADER));

  if (existing) {
    await githubApi("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
    console.log(`Updated existing comment #${existing.id}`);
  } else {
    await githubApi("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body });
    console.log("Created new comment");
  }
}

// ── status ────────────────────────────────────────────────────────────────────

async function cmdStatus(
  state: string,
  description: string,
  targetUrl: string,
): Promise<void> {
  const repo = env("GITHUB_REPOSITORY");
  const sha = input("sha");
  const context = input("context") || "Preview";
  await githubApi("POST", `/repos/${repo}/statuses/${sha}`, {
    state,
    description,
    target_url: targetUrl,
    context,
  });
  console.log(`Set commit status: ${state} - ${description}`);
}

// ── dispatch ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cmd = input("command");
  switch (cmd) {
    case "setup":
      cmdSetup();
      break;
    case "git-update": {
      const mode = input("mode");
      if (mode !== "deploy" && mode !== "remove") {
        console.error("Input 'mode' must be 'deploy' or 'remove' for command 'git-update'");
        process.exit(1);
      }
      await cmdGitUpdate(mode);
      break;
    }
    case "comment":
      await cmdComment();
      break;
    case "status": {
      const state = input("state");
      if (!state) {
        console.error("Input 'state' is required for command 'status'");
        process.exit(1);
      }
      await cmdStatus(state, input("description"), input("target-url"));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Input 'command' must be one of: setup, git-update, comment, status");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
