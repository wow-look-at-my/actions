# no-all-builds-job

Fail CI when any job is named `all-builds`.

The org's required merge check `all-builds` is a commit **status** posted by the required-builds-manager GitHub App (app id 3007670), which owns all-builds aggregation. Naming a workflow job `all-builds` is a recurring deception attempt in this org. It cannot cheat the gate, because the required check is pinned to the app. Its check run still **shadows the status of the app in the GitHub UI**. A red gate then looks green to anyone reading the checks list, and the reverse also happens. Operator ruling: no job may ever carry the name `all-builds`. CI must fail when one does.

Zero-config, and deliberately **no opt-out input**.

## Usage

```yaml
permissions:
  contents: read # checkout, for the workflow-file scan
  actions: read  # layer 1: this run's jobs
  checks: read   # layer 2: check runs on the head SHA

steps:
  - uses: actions/checkout@v4 # enables the workflow-file scan
  - uses: wow-look-at-my/actions@no-all-builds-job#latest
```

## How It Works

There are three independent detection layers. Any finding fails the job with the full explanation and the fix, which is to rename the job:

1. **This run's jobs** — lists the current workflow run's jobs via the Actions API and flags any whose rendered name is `all-builds` (including `all-builds (matrix)` and reusable-workflow forms like `ci / all-builds`). Needs `actions: read`.
2. **Check runs on the head SHA** — flags `all-builds`-named check runs from *other* workflows on the same commit. A check run posted by the required-builds-manager app itself, the owner of the gate, is exempt. Everything else wearing the name is flagged, an unattributed check run included. Needs `checks: read`.
3. **Workflow files** — scans `$GITHUB_WORKSPACE/.github/workflows/*.yml`/`.yaml` for a job *key* `all-builds` or a plain-string `name: all-builds`. Always runs and needs **no token**, only a checkout.

An API layer that cannot run **fails the action**. A token that lacks the permission does this, with `Resource not accessible by integration`. The guard fails closed instead of skipping the layer with a warning. Both API layers are attempted before the failure. A run that misses both permissions therefore reports both errors, and each one names the permission to grant. Only an explicitly empty `token: ''` skips the API layers, with a warning. The workflow-file scan still runs and still enforces.

Findings are not deduplicated across layers — the same job may be reported by more than one layer.

## Run-Once Within a Job

The guard deduplicates itself within a single job. A pass that found **nothing** exports the env var `NO_ALL_BUILDS_JOB_ALREADY_RAN=1` into the job env (`$GITHUB_ENV`). A later invocation in the same job sees the sentinel before it constructs any API client. The go-toolchain composite followed by buildhost-publish is one such pair, because each embeds this guard. That invocation logs `guard already ran earlier in this job — skipping duplicate check` and exits successfully at near-zero cost. The sentinel is deliberately **not** exported when the pass found violations. A failure suppressed with `continue-on-error` must never let a later invocation skip past the swallowed violation. That invocation re-detects it. Cross-job deduplication is out of scope, and every job re-checks.

`NO_ALL_BUILDS_JOB_ALREADY_RAN` is an internal dedupe mechanism, not an input. Setting it manually to suppress the guard is working around the check — the exact thing the failure message forbids.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `token` | No | `${{ github.token }}` | GitHub token. With `actions: read` it also scans this run's jobs, and with `checks: read` the head commit's check runs; the workflow-file scan runs regardless of token permissions. |

## Permissions

With a token present (the default — `${{ github.token }}`), the API layers must be able to run, or the guard fails naming the missing permission:

```yaml
permissions:
  contents: read # checkout, for the workflow-file scan
  actions: read  # layer 1: this run's jobs
  checks: read   # layer 2: check runs on the head SHA
```

Passing an explicit `token: ''` disables the API layers (warning only) and runs just the workflow-file scan, which needs no permissions.
