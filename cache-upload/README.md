# Cache Upload

Hand files to later jobs in the same workflow run via the GitHub Actions cache — an artifact-free replacement for `actions/upload-artifact`. Artifact storage is billed; cache storage is not.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-upload#latest
  with:
    name: go-build
    path: build/
```

Restore in a later job with [`cache-download`](../cache-download/), passing the same `name` and the byte-identical `path` string.

## How It Works

The files are saved with `actions/cache/save` under a run-unique key:

```
cache-xfer-<name>-<run_id>-<run_attempt>
```

- `github.run_id` scopes the hand-off to this workflow run — later jobs in the same run find it, and no other run ever can.
- `github.run_attempt` makes the key exact per attempt. On "re-run all jobs" the producer re-saves under the new attempt; on "re-run failed jobs" (where a succeeded producer does not re-run) [`cache-download`](../cache-download/)'s prefix restore-key still finds the newest earlier attempt's files.
- `enableCrossOsArchive: true` lets a hand-off saved on an ubuntu job be restored on macOS or Windows jobs.

## Why cache instead of artifacts

GitHub bills artifact storage; cache storage is free. For files that only need to travel from one job to a later job of the **same run**, the cache does the same work at no cost.

Caches are branch-scoped and LRU-evicted (unused for 7 days, or when the repo exceeds its cache cap). Neither matters for an intra-run hand-off: the consuming job runs minutes later, in the same run, on the same ref.

## The path contract

`path` accepts everything `actions/cache/save`'s `path` does (files, directories, wildcard patterns, multi-line lists). The matching `cache-download` MUST pass the **byte-identical** `path` string: the cache service derives the entry's version from the path spec, so a different string will not even find the entry. Files are always restored to the location they were saved from — the download side cannot retarget them.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | — | Hand-off name, unique within the workflow run (like an artifact name) |
| `path` | Yes | — | Files/directories to save (passed through to `actions/cache/save`'s `path`) |

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
