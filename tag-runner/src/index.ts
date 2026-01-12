import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

async function run(): Promise<void> {
  const token = core.getInput("token", { required: true });
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  // Get SHA from input or event
  const sha =
    core.getInput("sha") ||
    github.context.payload.registry_package?.package_version?.version ||
    github.context.sha;

  // Check package name - skip non-runner packages
  const pkgName = github.context.payload.registry_package?.name || "";
  if (pkgName && !pkgName.includes("linux-runner")) {
    core.info(`Skipping non-runner package: ${pkgName}`);
    return;
  }

  // Skip cache tags
  if (sha === "cache") {
    core.info("Skipping cache tag");
    return;
  }

  const image = `ghcr.io/${owner}/${repo}/linux-runner-ubuntu`;
  core.info(`Processing ${image}:${sha}`);

  // Find which branch has this SHA at HEAD
  const { data: branches } = await octokit.rest.repos.listBranches({
    owner,
    repo,
  });

  let branch: string | null = null;
  for (const b of branches) {
    if (b.commit.sha === sha) {
      branch = b.name;
      break;
    }
  }

  if (!branch) {
    core.warning(`Could not determine branch for SHA ${sha}`);
    return;
  }

  core.info(`Found branch: ${branch}`);

  // Check if SHA is still newest on branch
  const { data: branchData } = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });

  if (branchData.commit.sha !== sha) {
    core.warning(
      `Skipping - newer commit exists (${branchData.commit.sha} vs ${sha})`
    );
    return;
  }

  // Tag with branch name
  const tag = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  core.info(`Tagging ${image}:${sha} as ${tag}`);
  await exec.exec("docker", [
    "buildx",
    "imagetools",
    "create",
    "-t",
    `${image}:${tag}`,
    `${image}:${sha}`,
  ]);

  // Tag as latest if master
  if (branch === "master") {
    core.info(`Tagging ${image}:${sha} as latest`);
    await exec.exec("docker", [
      "buildx",
      "imagetools",
      "create",
      "-t",
      `${image}:latest`,
      `${image}:${sha}`,
    ]);

    // Trigger runner flush
    core.info("Triggering runner flush");
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "flush-runners.yml",
      ref: "master",
    });
  }

  core.info("Done");
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
