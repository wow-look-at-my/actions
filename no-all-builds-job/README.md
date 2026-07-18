# no-all-builds-job

Fail CI when any job is named `all-builds`.

The org's required merge check `all-builds` is a commit **status** posted by the required-builds-manager GitHub App (app id 3007670), which owns all-builds aggregation. Naming a workflow job `all-builds` is a recurring deception attempt in this org: it cannot cheat the gate — the required check is pinned to the app — but its check run **shadows the app's status in the GitHub UI**, making a red gate look green (or vice versa) to anyone reading the checks list. Operator ruling: no job may ever be named `all-builds`; CI must fail if one is.

Zero-config, and deliberately **no opt-out input**.

## Usage

```yaml
- uses: actions/checkout@v4 # enables the workflow-file scan
- uses: wow-look-at-my/actions@no-all-builds-job#latest
```

## How It Works

Three independent detection layers; any finding fails the job with the full explanation and the fix (rename the job):

1. **This run's jobs** — lists the current workflow run's jobs via the Actions API and flags any whose rendered name is `all-builds` (including `all-builds (matrix)` and reusable-workflow forms like `ci / all-builds`). Needs `actions: read`.
2. **Check runs on the head SHA** — flags `all-builds`-named check runs from *other* workflows on the same commit. Check runs posted by the required-builds-manager app itself (the gate's owner) are exempt; everything else wearing the name is flagged, including unattributed check runs. Needs `checks: read`.
3. **Workflow files** — scans `$GITHUB_WORKSPACE/.github/workflows/*.yml`/`.yaml` for a job *key* `all-builds` or a plain-string `name: all-builds`. Always runs and needs **no token**, only a checkout.

Layer 3 is load-bearing: org consumers' `permissions:` blocks mostly zero out `actions: read`/`checks: read`, so the API layers frequently degrade to warnings — the file scan is what keeps the guard enforcing exactly where it is deployed. API-layer failures never fail the job on their own; they are reported as warnings naming the permission that would enable them.

Findings are not deduplicated across layers — the same job may be reported by more than one layer.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `token` | No | `${{ github.token }}` | GitHub token. With `actions: read` it also scans this run's jobs, and with `checks: read` the head commit's check runs; the workflow-file scan runs regardless of token permissions. |

## Permissions

None required — the workflow-file scan works with any (or no) token. To enable the API layers as well:

```yaml
permissions:
  contents: read # checkout, for the workflow-file scan
  actions: read  # layer 1: this run's jobs
  checks: read   # layer 2: check runs on the head SHA
```
