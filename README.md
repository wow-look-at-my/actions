# Tag Runner

Tags runner container images with branch-based tags and triggers a runner flush when the master branch is updated.

## How It Works

1. Determines the image SHA from the input, `registry_package` event payload, or `github.sha`
2. Finds which branch has this SHA at HEAD
3. Skips if a newer commit exists on the branch (prevents stale tags)
4. Tags the image with the sanitized branch name using `docker buildx imagetools`
5. If the branch is `master`, also tags as `latest` and triggers the `flush-runners.yml` workflow

## Usage

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: ${{ secrets.RUNNER_TOKEN }}
```

### On registry package publish

```yaml
name: Tag runner image
on:
  registry_package:
    types: [published]

jobs:
  tag:
    runs-on: ubuntu-latest
    permissions:
      packages: write
      actions: write
    steps:
      - uses: wow-look-at-my/actions@tag-runner#latest
        with:
          token: ${{ secrets.RUNNER_TOKEN }}
```

### With explicit SHA

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    sha: ${{ github.event.workflow_run.head_sha }}
    token: ${{ secrets.RUNNER_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `sha` | No | Auto-detected | Image SHA to tag (falls back to `registry_package` version or `github.sha`) |
| `token` | Yes | — | GitHub token with `packages:write` and `actions:write` permissions |

## Behavior

- Skips non-runner packages (package name must contain `linux-runner`)
- Skips `cache` SHA tags
- Branch names are sanitized to `[a-zA-Z0-9._-]` for Docker tag compatibility
- Only tags if the SHA is still the latest commit on the branch
