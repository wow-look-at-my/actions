# Smart Cache

Drop-in replacement for `actions/cache` that only saves when files actually changed. Takes a snapshot of cached paths at restore time and compares at the end of the job — if nothing changed, it skips the save entirely.

## Usage

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: ~/.cache/go-build ~/go/pkg/mod
    key: go-${{ hashFiles('go.sum') }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `path` | Yes | | Paths to cache (space-separated) |
| `key` | Yes | | Cache key |

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Whether cache was restored (`true`/`false`) |

## How It Works

1. **Main step**: Restores cache using `@actions/cache`, snapshots all file mtimes
2. **Post step**: Re-snapshots file mtimes, diffs against the original
3. If any files were added, modified, or deleted — saves the cache
4. If nothing changed — skips save, avoiding redundant uploads

Cache reservation conflicts (from parallel jobs sharing a key) are handled gracefully as warnings rather than failures.
