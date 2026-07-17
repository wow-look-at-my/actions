# Cache Download

Restore files handed off by [`cache-upload`](../cache-upload/) earlier in the same workflow run — an artifact-free replacement for `actions/download-artifact`. Artifact storage is billed; cache storage is not.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-download#latest
  with:
    name: go-build
    path: build/
```

`path` is a **real destination directory** (created if missing, default: the workspace). It does not need to match anything the producer did — there is **no path contract** between the two sides.

## How It Works

The hand-off is looked up by key, not by path:

- exact key: `cache-xfer-<name>-<run_id>-<run_attempt>`
- restore-keys prefix: `cache-xfer-<name>-<run_id>-`

with a **constant** entry version (sha256 of a fixed format-revision literal — not `actions/cache`'s path-spec hash, which is what would otherwise force byte-identical path strings on both sides). `run_id` in the key scopes the hand-off to this workflow run.

The archive is self-describing: a directory hand-off extracts its tree into the destination (exec bits, symlinks, dotfiles intact); a single-file hand-off recreates `<dest>/<basename>` with its original permission bits. zstd and tar come from the runner image (all GitHub-hosted images ship zstd 1.5.7), and everything is streamed — nothing is buffered whole in memory.

## Re-runs

- **Re-run failed jobs**: the run gets a new `run_attempt`, but the producer job (which succeeded) does not re-run — the exact key misses and the `-<run_id>-` prefix restores the newest earlier attempt's files.
- **Re-run all jobs**: the producer re-uploads under the new attempt and the exact key matches it.
- Caveat: if a [`cache-cleanup`](../cache-cleanup/) job already deleted the failed run's entries (it runs on failure too, by design), "re-run failed jobs" has nothing left to restore — use "Re-run all jobs".

A missing hand-off fails loudly: `fail-on-cache-miss` defaults to `true`, so the job aborts instead of silently continuing without its files. Set it to `'false'` for an optional hand-off and check the `cache-matched-key` output.

## Stability note

Upload and download drive the cache service's twirp v2 endpoints directly (with the job's own `ACTIONS_RUNTIME_TOKEN` / `ACTIONS_RESULTS_URL`, which the runner injects into every step — no `permissions:` needed). Driving these endpoints is established practice (docker buildx `--cache-from type=gha` and sccache's GHA backend do the same), but they are not a documented public API; the mitigation is that the client library is **pinned to an exact version and bundled** into the released action. GHES (v1 cache service) is not supported.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | — | Hand-off name used by the matching `cache-upload` step |
| `path` | No | workspace | Destination directory to restore into (created if missing) |
| `fail-on-cache-miss` | No | `true` | Fail the job if the hand-off is not found |

## Outputs

| Name | Description |
|------|-------------|
| `download-path` | Absolute path of the directory the files were restored into |
| `cache-hit` | `true` on an exact key match (same run attempt); `false` when restored from an earlier attempt |
| `cache-matched-key` | Cache key actually restored (empty on a miss) |
