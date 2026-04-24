# Smart Cache

Cache with change detection — only saves when files actually changed. Avoids unnecessary cache writes that waste time and storage.

## Usage

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: ~/.cache/go-build ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}
```

## How It Works

1. **Main step**: Restores cache from the key, then snapshots all file modification times
2. **Post step** (runs automatically): Compares current file modification times against the snapshot
3. Only saves the cache if files were added, modified, or deleted

This prevents re-saving an unchanged cache on every run, which is especially useful for large caches (Go build cache, node_modules, etc.) where the save step can take significant time.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `path` | Yes | — | Paths to cache (space-separated) |
| `key` | Yes | — | Cache key |

## Outputs

| Name | Description |
|------|-------------|
| `cache-hit` | `true` if cache was restored, `false` otherwise |

## Comparison with `actions/cache`

| Feature | `actions/cache` | `smart-cache` |
|---------|----------------|---------------|
| Restore | Yes | Yes |
| Save | Always | Only if changed |
| Change detection | No | File mtime comparison |
| Cache reservation conflicts | Fails | Silently skips |

## Example: Go project

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: ~/.cache/go-build ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
```
