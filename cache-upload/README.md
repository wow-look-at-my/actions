# Cache Upload

Hand a file or directory to later jobs in the same workflow run via the GitHub Actions cache — an artifact-free replacement for `actions/upload-artifact`. Artifact storage is billed; cache storage is not.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-upload#latest
  with:
    name: go-build
    path: build/
```

Restore in a later job with [`cache-download`](../cache-download/) using the same `name` — the download destination is independent of this `path`. Optionally janitor entries at the end of the run with [`cache-cleanup`](../cache-cleanup/).

## How It Works

The payload is packed locally and stored through the cache service under a run-unique key:

```
cache-xfer-<name>-<run_id>-<run_attempt>
```

- A **directory** is captured as its **contents**: `tar -C <dir> .` streamed through `zstd --fast=2` (exec bits, symlinks, and dotfiles preserved by tar).
- A **single file** takes a raw fast path — no tar process at all; the file streams straight through zstd, and the archive records its basename and permission bits so the download side recreates `<dest>/<basename>` exactly.
- The archive is self-describing (a small `WXFR1` envelope header names the mode and codec), so the download side needs nothing but the `name`.
- Nothing is buffered whole in memory — packing is pure child-process streaming.

Unlike `actions/cache`, the entry's **version** is a constant (sha256 of a fixed format-revision literal), not a hash of the path spec — which is why upload and download have **no path contract at all**. The version literal is bumped when the payload format changes, so mixed-revision producers/consumers get a clean miss instead of a misparse.

### Why zstd

The fastest codec preinstalled on **all** GitHub-hosted runners: per the actions/runner-images software manifests, ubuntu-24.04, macos-15 (arm64), and windows-2025 all ship zstd 1.5.7, while lz4 is preinstalled only on ubuntu. Negative compression levels (`--fast=2`) trade ratio for speed — the right trade for a hand-off that lives minutes. A hand-off saved on ubuntu restores fine on macOS/Windows jobs.

## Why cache instead of artifacts

GitHub bills artifact storage; cache storage is free. For files that only travel from one job to a later job of the **same run**, the cache does the same work at no cost.

Caches are branch-scoped and LRU-evicted (unused for 7 days, or when the repo exceeds its cache cap) — irrelevant for an intra-run hand-off, where the consumer runs minutes later on the same ref. Use [`cache-cleanup`](../cache-cleanup/) as a terminal job to delete the run's entries rather than waiting for the service GC.

## Stability note

Upload and download drive the cache service's twirp v2 endpoints directly (with the job's own `ACTIONS_RUNTIME_TOKEN` / `ACTIONS_RESULTS_URL`, which the runner injects into every step — no `permissions:` needed). Driving these endpoints is established practice (docker buildx `--cache-to type=gha` and sccache's GHA backend do the same), but they are not a documented public API; the mitigation is that the client library is **pinned to an exact version and bundled** into the released action, so behavior only changes when this repo deliberately updates it. GHES (v1 cache service) is not supported.

## Re-runs

The exact key includes `run_attempt`; the matching `cache-download` also tries the prefix `cache-xfer-<name>-<run_id>-`, so "re-run failed jobs" (new attempt, succeeded producer not re-run) restores the newest earlier attempt's hand-off, while "re-run all jobs" exact-matches the new attempt. Caveat: if a [`cache-cleanup`](../cache-cleanup/) job already deleted the failed run's entries, "re-run failed jobs" has nothing to restore — use "Re-run all jobs".

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | — | Hand-off name, unique within the workflow run (like an artifact name) |
| `path` | Yes | — | File or directory to hand off (a directory is captured as its contents; missing path fails the job) |

## Outputs

| Name | Description |
|------|-------------|
| `key` | Cache key the hand-off was saved under |

## Example: build once, use in later jobs

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: just build
      - uses: wow-look-at-my/actions@cache-upload#latest
        with:
          name: go-build
          path: build/

  smoke-macos:
    needs: build
    runs-on: macos-latest
    steps:
      - uses: wow-look-at-my/actions@cache-download#latest
        with:
          name: go-build
          path: build/
      - run: ./build/mytool --version
```
