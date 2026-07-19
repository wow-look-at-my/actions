# download-release-binary

Download a platform-specific binary from a GitHub release and add it to `PATH`.

## Asset naming convention

Release assets **must** follow this naming pattern:

```
{name}_{os}_{arch}
{name}_{os}_{arch}.exe    # Windows
```

| Component | Values |
|-----------|--------|
| `os`      | `linux`, `darwin`, `windows` |
| `arch`    | `amd64`, `arm64` |

For example, a tool called `mytool` should have these release assets:

```
mytool_linux_amd64
mytool_linux_arm64
mytool_darwin_amd64
mytool_darwin_arm64
mytool_windows_amd64.exe
mytool_windows_arm64.exe
```

## Usage

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: mytool
    token: ${{ secrets.GITHUB_TOKEN }}
```

Download a specific version:

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: mytool
    version: v1.2.3
    token: ${{ secrets.GITHUB_TOKEN }}
```

Use the binary path in a later step:

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  id: tool
  with:
    repo: owner/repo
    name: mytool
    token: ${{ secrets.GITHUB_TOKEN }}

- run: ${{ steps.tool.outputs.path }} --version
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repo` | Yes | — | Repository to download from (`owner/name`) |
| `name` | No | `*` | Binary name filter. Matches assets named `{name}_{os}_{arch}`. If omitted, matches any asset and derives the name by stripping the platform suffix. |
| `version` | No | `latest` | Release tag to download |
| `token` | Yes | — | GitHub token for API authentication |

## Outputs

| Name | Description |
|------|-------------|
| `path` | Full path to the downloaded binary |

## How it works

1. Detects the runner's OS and architecture
2. Downloads the matching asset using `gh release download`
3. Renames the file by stripping the `_{os}_{arch}` suffix (so `mytool_linux_amd64` becomes `mytool`)
4. Makes it executable and adds `~/.local/bin` to `PATH`

## Uploading release assets

This action downloads from standard GitHub Releases. There is no corresponding upload action in this repository — use any tool that creates GitHub Releases with properly named assets:

- **GitHub CLI:** `gh release create v1.0.0 mytool_linux_amd64 mytool_darwin_arm64 ...`
- **GoReleaser:** Produces assets in this format by default
- **`actions/upload-release-asset`** or **`softprops/action-gh-release`** in a workflow
