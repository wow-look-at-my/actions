# upload-artifact (cache-backed)

A drop-in replacement for `actions/upload-artifact@v4` that stores the artifact in the **Actions cache service** instead of the Actions artifact storage service. Pair it with this repo's cache-backed `download-artifact` in a later job.

## Usage

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make build
      - uses: wow-look-at-my/actions@upload-artifact#latest
        with:
          name: build-output
          path: dist/

  consume:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: wow-look-at-my/actions@download-artifact#latest
        with:
          name: build-output
          path: dist/
```

Migrating from upstream is a one-line swap: `uses: actions/upload-artifact@v4` becomes `uses: wow-look-at-my/actions@upload-artifact#latest`. The inputs keep upstream's names and defaults.

## Inputs

| Input | Default | Description |
|---|---|---|
| `name` | `artifact` | Artifact name. Must be unique per run (see overwrite). |
| `path` | (required) | File, directory, or wildcard pattern of what to upload. Multi-line patterns and `!` exclusions work like upstream. |
| `if-no-files-found` | `warn` | `warn`, `error`, or `ignore`, with upstream semantics. |
| `retention-days` | | Accepted and **ignored**: the cache service self-manages retention (~7-day-unused eviction, LRU at the repo cap). |
| `compression-level` | | Accepted and **ignored**: the cache layer zstd-compresses payloads itself. |
| `overwrite` | `false` | Cache entries are immutable, so overwrite means delete-then-recreate. Needs `actions: write` on the token. |
| `include-hidden-files` | `false` | Include dot-files, like upstream. |
| `token` | `${{ github.token }}` | Used only for cache-management REST calls: the overwrite delete (`actions: write`) and usage diagnostics (`actions: read`). |

## Outputs

| Output | Description |
|---|---|
| `artifact-id` | The numeric cache entry id when the backend reports one (> 0), else empty. Not a REST "artifact" id. |
| `artifact-url` | Always empty: cache-backed artifacts have no browser download URL. |
| `artifact-digest` | SHA-256 of the uploaded payload tar. |
| `artifact-key` | The exact cache key used (for debugging; also visible in the repo's cache management UI). |

## Why cache-backed

The org's Actions **artifact** storage is unusable: artifact storage is billed against a shared storage pool, and with a $0 budget on that pool, uploads fail org-wide with:

```
Failed to CreateArtifact: Artifact storage quota has been hit. Unable to upload any new artifacts. Usage is recalculated every 6-12 hours.
```

Three properties make that unfixable from inside a workflow:

- **Deleting artifacts does not unblock uploads.** GitHub's own docs: "GitHub updates your artifact storage usage within 6 to 12 hours. Deleting artifacts frees up space for current storage, but does not reduce your accrued storage usage, which is used to calculate your storage billing for the current billing cycle." ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) Once overage has accrued in a cycle, only raising the budget or the next billing cycle unblocks.
- **A $0 budget is a hard stop.** "If any budget with Stop usage when budget limit is reached enabled is exhausted, additional usage is blocked." ([Setting up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets)) The docs exempt public-repo *minutes* and public *packages* from billing, but contain no such exemption for artifact storage, matching the observed failures on public repos.
- **The usage number itself lags 6-12 hours**, so the failure appears and clears unpredictably relative to anything a workflow does.

The Actions **cache** service is a different SKU with none of those failure modes: "Actions cache storage is a separate allowance of 10 GB per repository. Cache storage is not shared with artifacts or GitHub Packages." (same billing page) At the default 10 GB per-repo limit nothing ever accrues to a budget, and going over the cap **evicts instead of failing**: "If you exceed the limit, GitHub will save the new cache but will begin evicting caches until the total size is less than the repository limit." ([Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)) A cache-backed upload therefore cannot fail a workflow on quota. (Do not raise a repo's cache size limit above the free 10 GB while storage budgets are $0; the raised portion is billed and a blown budget flips the cache read-only.)

## What does not map

- **No browser download.** There is no human-facing download URL for cache entries; `artifact-url` is always empty. Human-download deliverables (release snapshots and the like) belong on the org's buildhost instead.
- **Repo-scoped.** Cache entries can never be read from another repository.
- **Branch-scoped restores.** A cache saved on ref R is restorable from R, PRs based on R, or the default branch, never from sibling branches. Job-to-job passing inside one run always works (same ref).
- **Read-only cache mode.** Runs triggered by `workflow_run`, `pull_request_target`, or `issue_comment` (resolving to the default branch) get read-only cache tokens since June 2026. This action detects that and **fails fast with an explanation** instead of letting the save silently no-op. Writer triggers: `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build`, `schedule` (plus `pull_request`/`release`, which use non-default-branch scopes).
- **`retention-days` and `compression-level` are ignored** (logged as such): the cache service evicts entries unused for ~7 days and zstd-compresses uploads itself.
- **Artifact names are immutable per run.** A second upload of the same name in one run attempt fails loudly with a diagnosis; `overwrite: true` deletes the entry and re-saves.
- **Same-OS-family restore by default.** The cache version hash covers the compression tool, so a payload saved on a runner without zstd cannot restore on one with it (all hosted runners ship zstd); Windows saves additionally carry a windows-only marker.
- **Eviction is possible (~10 GB LRU + ~7-day-unused).** An evicted entry makes the paired download **fail loudly with a diagnosis** (including repo cache usage), never silently produce an empty directory. Keep payloads small and download soon after uploading.
- **Keys are visible.** Cache keys appear in the repo's cache management UI and REST API to anyone with read access; the payload is fetchable from a workflow on an allowed ref. Do not put secrets in artifact names or payloads.
