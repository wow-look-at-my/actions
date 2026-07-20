# no-all-builds-job

Fail CI when any job is named `all-builds`.

The org's required merge check `all-builds` is a commit **status** posted by the required-builds-manager GitHub App (app id 3007670), which owns all-builds aggregation. Naming a workflow job `all-builds` is a recurring deception attempt in this org: it cannot cheat the gate — the required check is pinned to the app — but its check run **shadows the app's status in the GitHub UI**, making a red gate look green (or vice versa) to anyone reading the checks list. Operator ruling: no job may ever be named `all-builds`; CI must fail if one is.

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

Three independent detection layers; any finding fails the job with the full explanation and the fix (rename the job):

1. **This run's jobs** — lists the current workflow run's jobs via the Actions API and flags any whose rendered name is `all-builds` (including `all-builds (matrix)` and reusable-workflow forms like `ci / all-builds`). Needs `actions: read`.
2. **Check runs on the head SHA** — flags `all-builds`-named check runs from *other* workflows on the same commit. Check runs posted by the required-builds-manager app itself (the gate's owner) are exempt; everything else wearing the name is flagged, including unattributed check runs. Needs `checks: read`.
3. **Workflow files** — scans `$GITHUB_WORKSPACE/.github/workflows/*.yml`/`.yaml` for a job *key* `all-builds` or a plain-string `name: all-builds`. Always runs and needs **no token**, only a checkout.

An API layer that cannot run — e.g. the token lacks the permission (`Resource not accessible by integration`) — **fails the action**: the guard fails closed instead of skipping the layer with a warning. Both API layers are attempted before failing, so a run missing both permissions reports both errors, each naming the permission to grant. Only an explicitly empty `token: ''` skips the API layers (with a warning); the workflow-file scan still runs and enforces.

Findings are not deduplicated across layers — the same job may be reported by more than one layer.

## Run-Once Within a Job

The guard deduplicates itself within a single job. A pass that found **nothing** exports the env var `NO_ALL_BUILDS_JOB_ALREADY_RAN=1` into the job env (`$GITHUB_ENV`); a later invocation in the same job — e.g. the go-toolchain composite followed by buildhost-publish, each embedding this guard — sees the sentinel before constructing any API client, logs `guard already ran earlier in this job — skipping duplicate check`, and exits successfully at near-zero cost. The sentinel is deliberately **not** exported when violations were found: a failure suppressed with `continue-on-error` never lets a later invocation skip past the swallowed violation — it re-detects. Cross-job deduplication is out of scope; every job re-checks.

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
