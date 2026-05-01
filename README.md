# Cache Size

Shows what's consuming your GitHub Actions cache at a glance. Auto-detects Go build caches and breaks them down by module instead of showing useless hex shards.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-size#latest
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
| `depth` | No | `1` | Subdirectory levels to expand (`0` = totals only). Go build caches ignore this and always show top 10 modules. |

## Outputs

| Output | Description |
|--------|-------------|
| `total-bytes` | Total size in bytes across all paths |
| `breakdown` | JSON array of `{path, bytes, human}` objects |

## Example Output

Go build cache is broken down by module (top 10). Other directories expand normally at the configured depth:

```
Cache Size Breakdown
─────────────────────────────────────────────────
/home/runner/.cache/go-build              1.9 GiB
  modernc.org/libc                      412.0 MiB
  modernc.org/sqlite                    198.0 MiB
  modernc.org/cc                        156.0 MiB
  github.com/example/repo                89.0 MiB
  golang.org/x/tools                     67.0 MiB
  golang.org/x/net                       45.0 MiB
  github.com/stretchr/testify            23.0 MiB
  golang.org/x/sys                       18.0 MiB
  github.com/mattn/go-sqlite3            15.0 MiB
  gopkg.in/yaml.v3                       12.0 MiB
  (42 more)                             865.0 MiB
/home/runner/.cache/go-toolchain        241.6 MiB
  go1.24.11                             241.6 MiB
  deps.db                               12.0 KiB
/home/runner/go/pkg/mod                   1.3 GiB
  cache                                 774.0 MiB
  modernc.org                           336.1 MiB
  github.com                            176.1 MiB
  golang.org                             69.9 MiB
─────────────────────────────────────────────────
Total                                     3.5 GiB
```
