"use strict";

// dist/index.js
var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function() {
      return m[k];
    } };
  }
  Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  o[k2] = m[k];
}));
var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
  o["default"] = v;
});
var __importStar = exports && exports.__importStar || /* @__PURE__ */ (function() {
  var ownKeys = function(o) {
    ownKeys = Object.getOwnPropertyNames || function(o2) {
      var ar = [];
      for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
      return ar;
    };
    return ownKeys(o);
  };
  return function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) {
      for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
    }
    __setModuleDefault(result, mod);
    return result;
  };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var child_process_1 = require("child_process");
function env(name) {
  return process.env[name] || "";
}
function appendToFile(filePath, content) {
  fs.appendFileSync(filePath, content);
}
function writeEnvAndOutput(vars, envFile, outputFile) {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
  appendToFile(envFile, lines + "\n");
  appendToFile(outputFile, lines + "\n");
}
async function githubApi(method, endpoint, body) {
  const token = process.env.INPUT_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const opts = { method, headers };
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
  if (contentType.includes("application/json"))
    return resp.json();
  return resp.text();
}
var CACHE_BUST_SCRIPT = `<script>(function(){var q=location.search;if(!q)return;document.addEventListener("click",function(e){var a=e.target.closest("a");if(!a)return;var h=a.getAttribute("href");if(!h||h.startsWith("#")||/^[a-z][a-z0-9+.-]*:/i.test(h))return;try{var u=new URL(h,location.href);if(u.origin!==location.origin)return;if(!u.search)u.search=q;a.href=u.pathname+u.search+u.hash}catch(e){}})})();</script>`;
function findHtmlFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      results.push(...findHtmlFiles(full));
    else if (entry.name.endsWith(".html") || entry.name.endsWith(".htm"))
      results.push(full);
  }
  return results;
}
function injectCacheBustScript(targetDir) {
  const htmlFiles = findHtmlFiles(targetDir);
  for (const file of htmlFiles) {
    let content = fs.readFileSync(file, "utf8");
    if (content.includes("</body>"))
      content = content.replace("</body>", CACHE_BUST_SCRIPT + "</body>");
    else if (content.includes("</html>"))
      content = content.replace("</html>", CACHE_BUST_SCRIPT + "</html>");
    else
      content += CACHE_BUST_SCRIPT;
    fs.writeFileSync(file, content);
  }
  if (htmlFiles.length > 0)
    console.log(`Injected cache-bust script into ${htmlFiles.length} HTML file(s)`);
}
function calculatePagesBaseUrl(repo) {
  const [owner, repoName] = repo.split("/");
  if (repoName === `${owner}.github.io`)
    return `${owner}.github.io`;
  return `${owner}.github.io/${repoName}`;
}
function normalisePath(p) {
  return p.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
}
function removePrefixPath(basePath, originalPath) {
  const normBase = normalisePath(basePath);
  const normOriginal = normalisePath(originalPath);
  if (!normBase)
    return normOriginal;
  if (normOriginal.startsWith(normBase + "/"))
    return normOriginal.slice(normBase.length + 1);
  return normOriginal;
}
function determineAutoAction(eventName, eventPath) {
  if (eventName === "push") {
    const event2 = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const defaultBranch = event2.repository?.default_branch;
    const ref = env("GITHUB_REF");
    if (defaultBranch && ref === `refs/heads/${defaultBranch}`)
      return "deploy";
    console.error(`Push to non-default branch (${ref}), skipping`);
    return "none";
  }
  if (eventName !== "pull_request" && eventName !== "pull_request_target") {
    console.error(`unknown event ${eventName}; no action to take`);
    return "none";
  }
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const action = event.action;
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
function cmdSetup() {
  const inputAction = env("INPUT_ACTION") || "auto";
  const umbrellaDir = env("INPUT_UMBRELLA_DIR") || "pr-preview";
  const pagesBaseUrlInput = env("INPUT_PAGES_BASE_URL");
  const pagesBasePath = env("INPUT_PAGES_BASE_PATH");
  const prNumber = env("INPUT_PR_NUMBER");
  const actionRef = env("INPUT_ACTION_REF") || "unknown";
  const eventName = env("GITHUB_EVENT_NAME");
  const eventPath = env("GITHUB_EVENT_PATH");
  const repository = env("GITHUB_REPOSITORY");
  const envFile = env("GITHUB_ENV");
  const outputFile = env("GITHUB_OUTPUT");
  const pagesBaseUrl = pagesBaseUrlInput || calculatePagesBaseUrl(repository);
  const isPrEvent = eventName === "pull_request" || eventName === "pull_request_target";
  const previewFilePath = isPrEvent ? `${umbrellaDir}/pr-${prNumber}` : "";
  let previewUrlPath = "";
  if (previewFilePath) {
    previewUrlPath = removePrefixPath(pagesBasePath, previewFilePath);
    if (pagesBasePath && removePrefixPath("", previewFilePath) === previewUrlPath) {
      console.warn(`::warning title=pages-base-path doesn't match::The pages-base-path directory (${pagesBasePath}) does not contain umbrella-dir (${umbrellaDir}). pages-base-path has been ignored.`);
      previewUrlPath = previewFilePath;
    }
  }
  let deploymentAction = inputAction;
  if (deploymentAction === "auto") {
    console.error("Determining auto action");
    deploymentAction = determineAutoAction(eventName, eventPath);
    console.error(`Auto action is ${deploymentAction}`);
  }
  const basePreviewUrl = previewUrlPath ? `https://${pagesBaseUrl}/${previewUrlPath}/` : `https://${pagesBaseUrl}/`;
  let shortSha = "";
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const headSha = event.pull_request?.head?.sha || env("GITHUB_SHA") || "";
    shortSha = headSha.slice(0, 7);
  } catch {
    shortSha = (env("GITHUB_SHA") || "").slice(0, 7);
  }
  const previewUrl = shortSha ? `${basePreviewUrl}?v=${shortSha}` : basePreviewUrl;
  const actionStartTimestamp = Math.floor(Date.now() / 1e3).toString();
  const actionStartTime = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  writeEnvAndOutput({
    deployment_action: deploymentAction,
    preview_file_path: previewFilePath,
    pages_base_url: pagesBaseUrl,
    preview_url_path: previewUrlPath,
    preview_url: previewUrl,
    short_sha: shortSha,
    action_version: actionRef,
    action_start_time: actionStartTime,
    action_start_timestamp: actionStartTimestamp
  }, envFile, outputFile);
  console.log(`Action: ${deploymentAction}`);
  console.log(`Preview URL: ${previewUrl}`);
}
function run(cmd, cwd) {
  console.log(`$ ${cmd}`);
  (0, child_process_1.execSync)(cmd, { stdio: "inherit", cwd });
}
function cmdGitUpdate(mode) {
  const branch = env("INPUT_BRANCH");
  const token = env("INPUT_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const targetPath = env("INPUT_TARGET_PATH");
  const commitMessage = env("INPUT_COMMIT_MESSAGE");
  const sourceDir = env("INPUT_SOURCE_DIR");
  const workspace = env("GITHUB_WORKSPACE");
  const runnerTemp = env("RUNNER_TEMP") || path.join(workspace, "..");
  const dir = path.join(runnerTemp, "__gh-pages-content");
  if (fs.existsSync(dir))
    fs.rmSync(dir, { recursive: true });
  try {
    run(`git clone --depth 1 --branch "${branch}" "https://x-access-token:${token}@github.com/${repo}.git" "${dir}"`);
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    run("git init", dir);
    run(`git checkout --orphan "${branch}"`, dir);
    run(`git remote add origin "https://x-access-token:${token}@github.com/${repo}.git"`, dir);
  }
  if (mode === "deploy") {
    if (targetPath === "") {
      const umbrellaDir = env("INPUT_UMBRELLA_DIR") || "pr-preview";
      for (const entry of fs.readdirSync(dir)) {
        if (entry === ".git" || entry === umbrellaDir)
          continue;
        fs.rmSync(path.join(dir, entry), { recursive: true });
      }
      run(`cp -r "${path.join(workspace, sourceDir)}"/. "${dir}/"`);
      injectCacheBustScript(dir);
      const shortSha = env("short_sha");
      if (shortSha)
        fs.writeFileSync(path.join(dir, "version.txt"), shortSha + "\n");
    } else {
      const target = path.join(dir, targetPath);
      if (fs.existsSync(target))
        fs.rmSync(target, { recursive: true });
      fs.mkdirSync(target, { recursive: true });
      run(`cp -r "${path.join(workspace, sourceDir)}"/. "${target}/"`);
      injectCacheBustScript(target);
      const shortSha = env("short_sha");
      if (shortSha)
        fs.writeFileSync(path.join(target, "version.txt"), shortSha + "\n");
    }
  } else {
    const target = path.join(dir, targetPath);
    if (fs.existsSync(target))
      fs.rmSync(target, { recursive: true });
  }
  run('git config user.name "pr-preview-action[bot]"', dir);
  run('git config user.email "pr-preview-action[bot]@users.noreply.github.com"', dir);
  run("git add -A", dir);
  try {
    (0, child_process_1.execSync)("git diff --cached --quiet", { cwd: dir });
    console.log("No changes to commit.");
  } catch {
    run(`git commit -m "${commitMessage}"`, dir);
  }
  run(`git push -u origin "${branch}"`, dir);
  fs.rmSync(path.join(dir, ".git"), { recursive: true });
}
var COMMENT_HEADER = "<!-- Sticky Pull Request Comment pr-preview -->";
function generateDeployComment() {
  const actionVersion = env("action_version");
  const previewUrl = env("preview_url");
  const previewBranch = env("INPUT_PREVIEW_BRANCH") || "gh-pages";
  const serverUrl = env("GITHUB_SERVER_URL") || "https://github.com";
  const repository = env("GITHUB_REPOSITORY");
  const actionStartTime = env("action_start_time");
  return `${COMMENT_HEADER}
[PR Preview](https://github.com/wow-look-at-my/actions) ${actionVersion}
:---:
| :rocket: View preview at <br> ${previewUrl} <br><br>
| <h6>Built to branch [\`${previewBranch}\`](${serverUrl}/${repository}/tree/${previewBranch}) at ${actionStartTime}. <br> Preview is ready! <br><br> </h6>`;
}
function generateRemoveComment() {
  const actionVersion = env("action_version");
  const actionStartTime = env("action_start_time");
  return `${COMMENT_HEADER}
[PR Preview](https://github.com/wow-look-at-my/actions) ${actionVersion}
:---:
Preview removed because the pull request was closed.
${actionStartTime}`;
}
async function cmdComment() {
  const deploymentAction = env("deployment_action");
  const commentEnabled = env("INPUT_COMMENT");
  const prNumber = env("INPUT_PR_NUMBER");
  const repo = env("GITHUB_REPOSITORY");
  const dryRun = env("DRY_RUN") === "true";
  if (commentEnabled !== "true") {
    console.log("Comments disabled, skipping");
    return;
  }
  let body;
  if (deploymentAction === "deploy")
    body = generateDeployComment();
  else if (deploymentAction === "remove")
    body = generateRemoveComment();
  else {
    console.log(`No comment for action: ${deploymentAction}`);
    return;
  }
  if (dryRun) {
    process.stdout.write(body);
    return;
  }
  const comments = await githubApi("GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  const existing = comments.find((c) => c.body?.includes(COMMENT_HEADER));
  if (existing) {
    await githubApi("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
    console.log(`Updated existing comment #${existing.id}`);
  } else {
    await githubApi("POST", `/repos/${repo}/issues/${prNumber}/comments`, { body });
    console.log("Created new comment");
  }
}
async function cmdStatus(state, description, targetUrl) {
  const repo = env("GITHUB_REPOSITORY");
  const sha = env("INPUT_SHA");
  const context = env("INPUT_CONTEXT") || "Preview";
  await githubApi("POST", `/repos/${repo}/statuses/${sha}`, {
    state,
    description,
    target_url: targetUrl,
    context
  });
  console.log(`Set commit status: ${state} - ${description}`);
}
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "setup":
      cmdSetup();
      break;
    case "git-update": {
      const mode = args[0];
      if (mode !== "deploy" && mode !== "remove") {
        console.error("Usage: index.js git-update <deploy|remove>");
        process.exit(1);
      }
      cmdGitUpdate(mode);
      break;
    }
    case "comment":
      await cmdComment();
      break;
    case "status": {
      const [state, description, targetUrl] = args;
      if (!state) {
        console.error("Usage: index.js status <state> <description> <target_url>");
        process.exit(1);
      }
      await cmdStatus(state, description ?? "", targetUrl ?? "");
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Usage: index.js <setup|git-update|comment|status>");
      process.exit(1);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
