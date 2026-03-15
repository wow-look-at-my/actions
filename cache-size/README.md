# Cache Size

Shows what's consuming your GitHub Actions cache at a glance. Automatically collapses hex-sharded directories (like Go's build cache) so you see useful information instead of noise.

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
| `depth` | No | `1` | Subdirectory levels to expand (`0` = totals only). Hex-sharded dirs are auto-collapsed regardless of depth. |

## Outputs

| Output | Description |
|--------|-------------|
| `total-bytes` | Total size in bytes across all paths |
| `breakdown` | JSON array of `{path, bytes, human}` objects |

## Example Output

Default (`depth: 1`) — go-build auto-collapses, go/pkg/mod expands usefully:

```
Cache Size Breakdown
────────────────────────────────────────────
/home/runner/.cache/go-build       1.9 GiB
/home/runner/.cache/go-toolchain   241.6 MiB
  go1.24.11                        241.6 MiB
  deps.db                          12.0 KiB
/home/runner/go/pkg/mod            1.3 GiB
  cache                            774.0 MiB
  modernc.org                      336.1 MiB
  github.com                       176.1 MiB
  golang.org                       69.9 MiB
  gitlab.com                        6.6 MiB
  gotest.tools                      1.0 MiB
  gopkg.in                        741.9 KiB
  code.gitea.io                   432.7 KiB
  dario.cat                       107.3 KiB
────────────────────────────────────────────
Total                              3.5 GiB
```
