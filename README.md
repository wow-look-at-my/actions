# Cache Upload

Hand a file or directory to later jobs in the same workflow run through the GitHub Actions cache. It replaces `actions/upload-artifact` without an artifact. Artifact storage is billed. Cache storage is not.

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
cache-xfer-<run_id>-<name>-<run_attempt>
```

The **run id comes first**. Every hand-off of one run therefore shares the run-scoped prefix `cache-xfer-<run_id>-`. That is what lets a nameless [`cache-download`](../cache-download/) find this run's hand-off without its name. It can never match the entry of another run.

- A **directory** is captured as its **contents**: `tar -C <dir> .` streamed through `zstd --fast=2` (exec bits, symlinks, and dotfiles preserved by tar).
- A **single file** takes a raw fast path, with no tar process at all. The file streams straight through zstd. The archive records its basename and permission bits, so the download side recreates `<dest>/<basename>` exactly.
- The archive is self-describing. A small `WXFR1` envelope header names the mode, the codec, and the hand-off `name`. The download side therefore needs nothing at all. A nameless `cache-download` finds the run's hand-off and reports which name it picked.
- Nothing is buffered whole in memory. Packing is pure child-process streaming.

The entry **version** is a constant, the sha256 of a fixed format-revision literal. `actions/cache` hashes the path spec instead. That is why upload and download have **no path contract at all**. A change to the payload format bumps the version literal. A mixed-revision producer and consumer then get a clean miss instead of a misparse.

### Why zstd

zstd is the fastest codec preinstalled on **all** GitHub-hosted runners. The actions/runner-images software manifests show zstd 1.5.7 on ubuntu-24.04, macos-15 (arm64), and windows-2025. lz4 is preinstalled only on ubuntu. A negative compression level (`--fast=2`) trades ratio for speed. That is the right trade for a hand-off that lives minutes. A hand-off saved on ubuntu restores correctly on a macOS or Windows job.

## Why cache instead of artifacts

GitHub bills artifact storage. Cache storage is free. For files that only travel from one job to a later job of the **same run**, the cache does the same work at no cost.

Caches are branch-scoped, and LRU eviction removes an entry after 7 unused days or when the repo exceeds its cache cap. Neither matters for an intra-run hand-off, where the consumer runs minutes later on the same ref. Use [`cache-cleanup`](../cache-cleanup/) as a terminal job to delete the run's entries rather than waiting for the service GC.

## Stability note

Upload and download drive the twirp v2 endpoints of the cache service directly. They use the job's own `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL`, which the runner injects into every step, so no `permissions:` entry is needed. Driving these endpoints is established practice. docker buildx `--cache-to type=gha` and the GHA backend of sccache do the same. The endpoints are still not a documented public API.

This risk is accepted, not mitigated. GitHub has changed this protocol before. The legacy REST flavor was shut off in 2025 in favor of the twirp service. A bundled pin cannot protect against a server-side shutdown. The next protocol move breaks these actions **loudly**, with RPC errors and failed jobs, never silent corruption. They stay broken until `@actions/cache` is bumped here and the actions are republished. The containment is the release model, not the pin. Every consumer rides the moving `<name>#latest` tags, so the fix lands org-wide from this one repo, and no consumer workflow changes. In 2025 every action pinning an old `@actions/cache` had to update on its own. The pin and the bundle only keep releases hermetic and reviewable. GHES, which runs the v1 cache service, is not supported.

## Re-runs

The exact key includes `run_attempt`. The matching `cache-download` also tries the prefix `cache-xfer-<run_id>-<name>-`. "Re-run failed jobs" starts a new attempt and does not re-run the succeeded producer, so that prefix restores the newest earlier attempt's hand-off. "Re-run all jobs" exact-matches the new attempt. Caveat: a [`cache-cleanup`](../cache-cleanup/) job can already have deleted the failed run's entries. "Re-run failed jobs" then has nothing to restore. Use "Re-run all jobs".

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
