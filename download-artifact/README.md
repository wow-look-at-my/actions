# download-artifact (cache-backed)

The counterpart to this repo's cache-backed `upload-artifact`: restores an artifact that a previous job uploaded through the **Actions cache service** and extracts it to the requested path. A drop-in replacement for `actions/download-artifact@v4` for the single-named-artifact case.

## Usage

```yaml
jobs:
  consume:
    needs: build   # the job that ran the cache-backed upload-artifact
    runs-on: ubuntu-latest
    steps:
      - uses: wow-look-at-my/actions@download-artifact#latest
        with:
          name: build-output
          path: dist/
```

Migrating from upstream is a one-line swap: `uses: actions/download-artifact@v4` becomes `uses: wow-look-at-my/actions@download-artifact#latest`, with one caveat: **`name` is required in practice** (there is no download-all mode; see below).

If the same job also runs `actions/checkout`, put the download step **after** the checkout (checkout wipes the workspace it clones into).

## Inputs

| Input | Default | Description |
|---|---|---|
| `name` | | Name of the artifact to download. Required in practice: an empty name fails the step with an explanation (no download-all mode). |
| `path` | `$GITHUB_WORKSPACE` | Destination path. Supports basic tilde expansion; relative paths resolve against the workspace. |
| `github-token` | `${{ github.token }}` | Used only for restore-miss diagnostics (cache listing/usage reads; needs `actions: read`). |
| `run-id` | current run | The run whose upload to download. Another run's id works only when that run saved on a ref this run can restore from (same branch, a PR's base branch, or the default branch). |
| `repository` | current repo | Accepted for compatibility; any value other than the current repository fails the step (cache-backed artifacts are repo-scoped). |
| `pattern` | | **Not supported**: setting it fails the step. Use explicit names. |
| `merge-multiple` | `false` | **Not supported**: setting it to true fails the step. Use explicit names. |
| `artifact-ids` | | **Not supported**: setting it fails the step. Use explicit names. |

## Outputs

| Output | Description |
|---|---|
| `download-path` | Absolute path the artifact was extracted to. |

## Loud misses

A restore miss is never a silent empty directory. On a miss the action runs a three-step REST diagnosis (each step degrades gracefully when the token lacks `actions: read`):

1. **Does the exact key exist on another ref?** Prints each entry's ref/created/size and explains branch scoping (a cache saved on ref R is restorable from R, PRs based on R, or the default branch).
2. **What did this run actually save?** Lists the run's `ghart-v1-...` keys, which catches name typos immediately.
3. **Repo cache usage**: at N GB of the ~10 GB cap, a save that succeeded earlier may have been LRU-evicted.

Then the step fails with a one-paragraph verdict naming the most likely cause.

## Why cache-backed

See the `upload-artifact` README for the full evidence. Short version: artifact-storage uploads fail org-wide under the $0 storage budget ("Artifact storage quota has been hit"), deleting artifacts "does not reduce your accrued storage usage" per GitHub's docs, and the usage number lags 6-12 hours, so the artifact service is unusable. The cache service is a separate free-at-10-GB SKU that evicts instead of failing.

## What does not map

- **No browser download**: cache entries have no human-facing URL. Human deliverables belong on the org's buildhost.
- **Repo-scoped**: no cross-repository downloads (a foreign `repository` input fails the step).
- **Branch-scoped**: restores see the saving ref, PRs based on it, and the default branch only. Job-to-job within one run always works.
- **No download-all / pattern / merge-multiple / artifact-ids**: one artifact per step, by explicit name; unsupported inputs fail loudly rather than being silently ignored.
- **Eviction is possible** (~10 GB LRU + ~7-day-unused): an evicted entry fails the download loudly with the diagnosis above, never silently.
- **Same-OS-family restore by default**: the cache version hash covers the compression tool (and a windows-only marker on Windows saves).
