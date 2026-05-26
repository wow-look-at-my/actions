# Download Executable Artifact

Download a GitHub Actions artifact, optionally rename files, and set the executable bit.

## Usage

### Download all files from an artifact

```yaml
- uses: wow-look-at-my/actions@download-exe#latest
  with:
    name: my-build
```

### Select and rename specific files

```yaml
- uses: wow-look-at-my/actions@download-exe#latest
  with:
    name: my-build
    files: |
      my-tool-linux-amd64:my-tool
      config.yaml
```

### Download from another workflow run

```yaml
- uses: wow-look-at-my/actions@download-exe#latest
  with:
    name: my-build
    run-id: ${{ github.event.workflow_run.id }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Merge multiple artifacts

```yaml
- uses: wow-look-at-my/actions@download-exe#latest
  with:
    name: build-artifacts
    pattern: 'build-*'
    merge-multiple: true
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | — | Artifact name to download |
| `path` | No | `.` | Directory to download artifact into |
| `files` | No | All files | Files to process (newline-separated). Use `source:dest` to rename. |
| `executable` | No | `true` | Set `+x` on downloaded files |
| `run-id` | No | Current run | Run ID to download artifact from |
| `github-token` | No | `github.token` | GitHub token for artifact download |
| `pattern` | No | — | Glob pattern to match artifact names |
| `merge-multiple` | No | `false` | Merge multiple artifacts into the same directory |

## File Processing

When `files` is empty, all files in the download directory get `+x` (if `executable` is true).

When `files` is specified, each line is processed:
- **Plain filename** (`my-tool`): keeps the file as-is, sets `+x`
- **Rename mapping** (`source:dest`): renames `source` to `dest`, sets `+x`
