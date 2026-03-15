# Cache Size

Shows what's consuming your GitHub Actions cache at a glance.

## Usage

```yaml
- uses: wow-look-at-my/actions/cache-size@latest
  with:
    paths: |
      ~/.cache/go-build
      ~/.cache/go-toolchain
      ~/go/pkg/mod
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `paths` | Yes | | Directories to measure (newline or space separated) |
| `depth` | No | `0` | Subdirectory levels to expand (`0` = totals only, `1` = one level of children) |

## Outputs

| Output | Description |
|--------|-------------|
| `total-bytes` | Total size in bytes across all paths |
| `breakdown` | JSON array of `{path, bytes, human}` objects |

## Example Output

Default (`depth: 0`) — just the totals:

```
Cache Size Breakdown
────────────────────────────────────────────
/home/runner/.cache/go-build       1.9 GiB
/home/runner/.cache/go-toolchain   241.6 MiB
/home/runner/go/pkg/mod            1.3 GiB
────────────────────────────────────────────
Total                              3.5 GiB
```

With `depth: 1` — one level of children:

```
Cache Size Breakdown
────────────────────────────────────────────
/home/runner/.cache/pip    12.3 MiB
  wheels                   10.1 MiB
  http                      2.2 MiB
/home/runner/.npm          45.6 MiB
  _cacache                 40.2 MiB
  _logs                     5.4 MiB
────────────────────────────────────────────
Total                      57.9 MiB
```
