# Cache Cleanup

Delete this run's [`cache-upload`](../cache-upload/) hand-offs, and sweep aged ones left behind by crashed or cancelled runs. The cache service has no per-entry TTL. A short hand-off lifetime therefore needs explicit deletion. Without it, an entry lingers until the service GC removes it, after 7 unused days or under repo-cap LRU.

## Usage

Run it as a **terminal job** that fires on success and failure:

```yaml
jobs:
  cache-cleanup:
    needs: [publish]   # your terminal job — transitively after everything
    if: always()
    runs-on: ubuntu-latest
    permissions:
      actions: write   # required to delete cache entries
    steps:
      - uses: wow-look-at-my/actions@cache-cleanup#latest
```

## What it deletes

One paginated pass runs over the repo's `cache-xfer-*` entries. An entry is deleted when either:

1. **It belongs to this run** — key matches `cache-xfer-<run_id>-<name>-<attempt>` for the current `run_id`, any attempt. During the v2 transition the pre-v2 (name-first) layout `cache-xfer-<name>-<run_id>-<attempt>` is matched too, so a mid-rollout run mixing old and new producers is still fully cleaned. This is the normal end-of-run cleanup.
2. **It is aged out** — its `last_accessed_at` (falling back to `created_at`) is older than `max-age` (default `12h`, and `'0'` disables the sweep). This is what bounds the leftovers of a crashed or cancelled run whose own cleanup never ran. Every later run janitors the namespace, and no cron is needed. The sweep keys off the entry's timestamps, not its key layout, so it covers both layouts by construction. The service's 7-day-unused GC remains the final backstop.

With `name` set, both phases are scoped to that one hand-off name. (Under the run-id-first layout a name is no longer a key prefix, so the listing always covers the whole `cache-xfer-` namespace and the name scoping is applied client-side — against both layouts.)

Because cleanup runs on **failure too**, a failed run's hand-offs are deleted at its end — after that, "Re-run failed jobs" cannot restore them (the producing jobs are gone from the re-run as well), so use **"Re-run all jobs"**. Within a run, and for re-run-all, the download side's attempt-prefix fallback still applies.

## API and permissions

Uses only the documented public REST API (with the injected `github.token` by default):

- [`GET /repos/{owner}/{repo}/actions/caches`](https://docs.github.com/en/rest/actions/cache#list-github-actions-caches-for-a-repository) — `key` is "An explicit key or prefix for identifying the cache". Each entry carries `id`, `key`, `ref`, `last_accessed_at`, `created_at`, and `size_in_bytes`.
- [`DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}`](https://docs.github.com/en/rest/actions/cache#delete-a-github-actions-cache-for-a-repository-using-a-cache-id)

Both require `actions: write`. The calling job must declare it, as Usage shows. The default `GITHUB_TOKEN` of a plain job does not carry it.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | No | all hand-offs | Only clean entries of this hand-off name |
| `max-age` | No | `12h` | Also delete any hand-off entry last accessed longer ago than this, e.g. `12h`, `90m`, `2d` (`0` disables the sweep) |
| `github-token` | No | `${{ github.token }}` | Token with `actions: write` on the repository |

## Outputs

| Name | Description |
|------|-------------|
| `deleted-count` | Number of cache entries deleted |
