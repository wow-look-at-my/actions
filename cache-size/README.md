# Cache Size

Reports a clean breakdown of disk usage for directories you're caching.

## Usage

```yaml
- uses: wow-look-at-my/actions/cache-size@latest
  with:
    paths: |
      ~/.cache/pip
      ~/.npm
      ~/.cargo/registry
    depth: 1  # optional, default 1
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `paths` | Yes | | Directories to measure (newline or space separated) |
| `depth` | No | `1` | How many levels deep to break down |

## Outputs

| Output | Description |
|--------|-------------|
| `total-bytes` | Total size in bytes across all paths |
| `breakdown` | JSON array of `{path, bytes, human}` objects |

## Example Output

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
