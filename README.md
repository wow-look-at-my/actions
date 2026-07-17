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

### [Download Artifact (cache-backed)](download-artifact/)

```yml
# Download a cache-backed artifact that was uploaded by this repo's cache-backed upload-artifact action.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/download-artifact/README.md
- uses: wow-look-at-my/actions@download-artifact#latest
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

### [TypeScript](typescript/)

```yml
# Run an inline TypeScript script, validated with tsc, with helpful globals pre-injected..
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/typescript/README.md
- uses: wow-look-at-my/actions@typescript#latest
```

### [Upload Artifact (cache-backed)](upload-artifact/)

```yml
# Upload a build artifact via the Actions cache service -- a drop-in replacement for actions/upload-artifact that is immune to the artifact storage quota.
# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/upload-artifact/README.md
- uses: wow-look-at-my/actions@upload-artifact#latest
  with:
    path: # A file, directory or wildcard pattern that describes what to upload
```

## Reusable Workflows

### PR Preview (buildhost)

```yml
jobs:
  buildhost-preview:
    uses: wow-look-at-my/actions/.github/workflows/buildhost-preview.yml@master
```

Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project and posts a sticky PR comment with the preview URL. Authenticates to buildhost via GitHub OIDC (no static secret). PRs deploy to a `pr-<number>` branch; pushes deploy to `branch/<ref-name>`.

The caller must declare the permissions the reusable workflow needs (a reusable workflow cannot escalate beyond its caller):

```yml
name: PR preview
on:
  push:
    branches: [master]
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  contents: read
  actions: read         # only needed when using artifact-name
  pull-requests: write  # sticky comment
  id-token: write       # OIDC to buildhost

jobs:
  preview:
    uses: wow-look-at-my/actions/.github/workflows/buildhost-preview.yml@master
    with:
      source-dir: ./site   # directory to deploy (defaults to ".")
    secrets: inherit
```

To deploy a previously-uploaded run artifact instead of checking out `source-dir`, pass `artifact-name` (mutually exclusive with `source-dir`):

```yml
jobs:
  preview:
    uses: wow-look-at-my/actions/.github/workflows/buildhost-preview.yml@master
    with:
      artifact-name: build
    secrets: inherit
```

Notes:

- `project` defaults to the repository name. buildhost derives the project as the **lowercase** repo name and rejects a mismatch, so pin `project:` explicitly if your repo name is not already lowercase.
- `public: true` serves the preview without buildhost auth even when the source repo/project is private (opt-in; default `false` keeps a private repo's preview gated).
- Fork PRs are skipped (they receive no OIDC token and cannot authenticate to buildhost).
- For the GitHub Pages flavour, use the `pr-preview.yml` reusable workflow instead.

### Publish to GHCR

```yml
jobs:
  publish-ghcr:
    uses: wow-look-at-my/actions/.github/workflows/publish-ghcr.yml@master
```

To opt in to instant docker-updater notifications after a push (recommended for private images, which don't emit GitHub package webhooks), pass the secret. The URL defaults to `https://docker-updater-hook.pazer.io/`:

```yml
jobs:
  publish-ghcr:
    uses: wow-look-at-my/actions/.github/workflows/publish-ghcr.yml@master
    secrets:
      updater-webhook-secret: ${{ secrets.DOCKER_UPDATER_WEBHOOK_SECRET }}
```

Set `DOCKER_UPDATER_WEBHOOK_SECRET` (same value as docker-updater's `DOCKER_UPDATER_GITHUB_WEBHOOK_SECRET`) at the org level. Callers that omit the secret get today's behavior unchanged.
