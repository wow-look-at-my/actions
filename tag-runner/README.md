# Tag Runner Image

Tags container runner images with branch and `latest` tags after they're published, then triggers a flush workflow to roll out the new image.

## Usage

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: ${{ secrets.RUNNER_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | Yes | | GitHub token with `packages:write` and `actions:write` permissions |
| `sha` | No | Auto-detected | Image SHA to tag (defaults to `github.sha` or the registry package version) |

## How It Works

1. Determines the image SHA from the input, `registry_package` event payload, or `github.sha`
2. Skips non-runner packages and cache tags
3. Finds which branch has the SHA at HEAD
4. Verifies the SHA is still the newest commit on that branch (avoids tagging stale builds)
5. Tags the image with the branch name (e.g. `master`, `feature-foo`)
6. If the branch is `master`, also tags as `latest`
7. Dispatches a `flush-runners` workflow to roll out the update
