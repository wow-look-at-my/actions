# download-release-binary

Download a platform-specific binary and add it to `PATH`. Tries [buildhost](https://pazer.build) first, falls back to GitHub Releases.

## Usage

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: mytool
```

Download a specific version:

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: mytool
    version: v1.2.3
```

With a GitHub token for the fallback path (needed for private repos not on buildhost):

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: mytool
    token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repo` | Yes | -- | Repository to download from (`owner/name`) |
| `name` | No | repo name | Binary/project name. Used as the buildhost project name and as the GitHub asset filter (`{name}_{os}_{arch}`). |
| `version` | No | `latest` | Release tag to download |
| `token` | No | -- | GitHub token (only needed when falling back to GitHub Releases) |

## Outputs

| Name | Description |
|------|-------------|
| `path` | Full path to the downloaded binary |

## How it works

1. Detects the runner's OS and architecture
2. Tries `https://pazer.build/dl/{project}/{version}/{os}/{arch}`
3. If buildhost returns a non-200 or is unreachable, falls back to `gh release download` from GitHub Releases
4. Installs the binary to `~/.local/bin` and adds it to `PATH`

## Asset naming convention (GitHub Releases fallback)

When falling back to GitHub Releases, assets must follow this naming pattern:

```
{name}_{os}_{arch}
{name}_{os}_{arch}.exe    # Windows
```

| Component | Values |
|-----------|--------|
| `os`      | `linux`, `darwin`, `windows` |
| `arch`    | `amd64`, `arm64` |
