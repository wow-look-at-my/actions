# common-checks

One step that runs the checks every repository in this org wants.

Today that is [yaml-comment-block](../yaml-comment-block/) and [no-tests-in-yaml](../no-tests-in-yaml/). A check added here reaches every caller on the next run of `common-checks`, with no edit to their workflow.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: wow-look-at-my/actions@common-checks#latest
```

## Once Per Workflow Run

The checks here scan the whole workspace, so a second run of them finds exactly what the first one found. The first step of this action is therefore [run-once](../run-once/), which claims the name `common-checks` for one job of the run. Every other job of that run reads `first: false` and skips the checks, in a step that costs one RPC. A workflow of thirty jobs scans the repository once.

Each job is a fresh runner with a fresh environment. The claim therefore lives outside the runner, as a cache entry keyed by run id, run attempt, and claim name. A re-run of failed jobs raises the attempt, so the new attempt claims afresh instead of skipping everywhere.

A cache service that cannot hold the claim makes every job run the checks and log a warning. A check that runs twice costs seconds. A check skipped everywhere reports nothing at all.

The same mechanism covers a second `uses:` of this action inside one job. The second call collides with the claim its own job stored, so it skips.

## Submodules

A submodule is another repository, with its own CI and its own run of these checks. This action reads `.gitmodules` and excludes every submodule path from the scan. A finding in a submodule belongs to the pull request of that repository, where an engineer can act on it. The exclusion covers nested submodules, because the pattern is `<path>/**`.

An uninitialized submodule leaves an empty directory, and the exclusion of it costs nothing.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `exclude` | No | *(empty)* | Extra glob patterns for files every check skips, newline or comma separated. Submodule paths are excluded already. Use this for fixtures that break a rule on purpose. |
