# GitHub Actions

Reusable GitHub Actions.

## Actions

### [Action Validator](action-validator/)

```yml
# Validate GitHub Action action.yml files.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/action-validator/README.md
- uses: wow-look-at-my/actions@action-validator#latest
```

### [Branch Block](branch-block/)

```yml
# Add merged branches to a ruleset that blocks re-creation.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/branch-block/README.md
- uses: wow-look-at-my/actions@branch-block#latest
  with:
    branch: # Branch name to block
```

### [Cache rg](cache-rg/)

```yml
# Install ripgrep from apt with the .deb cached between runs (ubuntu-latest only).
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/cache-rg/README.md
- uses: wow-look-at-my/actions@cache-rg#latest
```

### [Cache Size](cache-size/)

```yml
# Report disk usage breakdown of cached directories.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/cache-size/README.md
- uses: wow-look-at-my/actions@cache-size#latest
  with:
    paths: # Directories to measure (newline or space separated)
```

### [Download Executable Artifact](download-exe/)

```yml
# Download an artifact, optionally select/rename files, and set +x.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/download-exe/README.md
- uses: wow-look-at-my/actions@download-exe#latest
  with:
    name: # Artifact name to download
```

### [Download Release Binary](download-release-binary/)

```yml
# Download a platform-specific binary from a GitHub release.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/download-release-binary/README.md
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: # Repository (owner/name) to download from
    token: # GitHub token for API authentication (e.g. github.token)
```

### [GHCR Prune](ghcr-prune/)

```yml
# Prune old container image versions from GHCR, keeping the last N tagged versions and their referenced untagged versions..
- uses: wow-look-at-my/actions@ghcr-prune#latest
  with:
    image: # Full image reference (e.g., ghcr.io/owner/package:tag)
    keep: # Number of tagged versions to keep
```

### [GHCR](ghcr/)

```yml
# Build, push, and prune container images on GHCR..
- uses: wow-look-at-my/actions@ghcr#latest
```

### [Go Packages](go-packages/)

```yml
# Build Go binaries with go-toolchain and publish multi-arch scratch container images to GHCR..
- uses: wow-look-at-my/actions@go-packages#latest
```

### [Multi-Command](multicmd/)

```yml
# Run OS-specific commands in a single step without boilerplate if-checks.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/multicmd/README.md
- uses: wow-look-at-my/actions@multicmd#latest
```

### [No Scripts Check](no-scripts-action/)

```yml
# Ensures package.json files do not contain scripts sections (use justfiles instead).
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/no-scripts-action/README.md
- uses: wow-look-at-my/actions@no-scripts-action#latest
```

### [Orphan Release](orphan-release/)

```yml
# Create orphan tags from a directory.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/orphan-release/README.md
- uses: wow-look-at-my/actions@orphan-release#latest
```

### [Fetch Secrets](secret-server/)

```yml
# Fetch secrets from a self-hosted secret server using GitHub Actions OIDC.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/secret-server/README.md
- uses: wow-look-at-my/actions@secret-server#latest
```

### [Smart Cache](smart-cache/)

```yml
# Cache with change detection - only saves when files actually changed.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/smart-cache/README.md
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: # Paths to cache (space-separated)
    key: # Cache key
```

### [Tag Runner Image](tag-runner/)

```yml
# Tags runner images with branch/latest tags and triggers flush.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/tag-runner/README.md
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: # GitHub token with packages:write and actions:write permissions
```

### [Install timeout (macOS)](timeout-macos/)

```yml
# Makes GNU timeout available on macOS runners by installing coreutils via Homebrew.
- uses: wow-look-at-my/actions@timeout-macos#latest
```
