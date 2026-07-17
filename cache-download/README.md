# Cache Download

Restore files handed off by [`cache-upload`](../cache-upload/) earlier in the same workflow run — an artifact-free replacement for `actions/download-artifact`. Artifact storage is billed; cache storage is not.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-download#latest
  with:
    name: go-build
    path: build/
```

`name` and `path` must match the producing [`cache-upload`](../cache-upload/) step — `path` byte-for-byte (see below).

## How It Works

Files are restored with `actions/cache/restore` using:

- exact key: `cache-xfer-<name>-<run_id>-<run_attempt>`
- restore-keys prefix: `cache-xfer-<name>-<run_id>-`

`github.run_id` in both scopes the lookup to this workflow run — a hand-off from any other run can never match. The prefix fallback handles re-runs:

- **Re-run failed jobs**: the run gets a new `run_attempt`, but the producer job (which succeeded) does not re-run, so the exact key misses; the `-<run_id>-` prefix then restores the newest earlier attempt's files.
- **Re-run all jobs**: the producer re-saves under the new attempt, and the exact key matches it.

A missing hand-off fails loudly: `fail-on-cache-miss` defaults to `true`, so the job aborts instead of silently continuing without its files. Set it to `'false'` for an optional hand-off and check the `cache-matched-key` output instead.

`enableCrossOsArchive: true` (set on both sides) lets e.g. an ubuntu-saved hand-off restore on macOS or Windows jobs.

## The path contract

`path` MUST be **byte-identical** to the string given to `cache-upload`: the cache service derives the entry's version from the path spec, so a different string will not find the entry at all. Files are restored to the location they were saved from — this action cannot retarget them to another directory.

## Why cache instead of artifacts

GitHub bills artifact storage; cache storage is free. Caches are branch-scoped and LRU-evicted (unused for 7 days, or when the repo exceeds its cache cap) — both irrelevant for an intra-run hand-off, where the consumer runs minutes after the producer, in the same run, on the same ref.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | — | Hand-off name used by the matching `cache-upload` step |
| `path` | Yes | — | Files/directories to restore; must be byte-identical to the `path` given to `cache-upload` |
| `fail-on-cache-miss` | No | `true` | Fail the job if the hand-off is not found |

## Outputs

| Name | Description |
|------|-------------|
| `cache-hit` | `true` on an exact key match (same run attempt); `false` when restored via the prefix restore-key |
| `cache-matched-key` | Key of the cache entry actually restored (empty on a miss) |
