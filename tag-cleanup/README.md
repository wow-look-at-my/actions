# Tag Cleanup

Sweep [`orphan-release`](../orphan-release/) tags that name things which no longer exist. The release script mints `<action>#1` and `<action>#latest` from the default branch, plus `<action>/<branch>#N` from feature branches. When the named thing disappears, its tags stay behind. A stale `#latest` keeps serving old code to every consumer that resolves it by default.

## What gets deleted

A tag is deleted when the part after its last `#` is neither a number nor `latest`. A past bug minted tags like `smart-cache#null`. The release script refuses to create them now. This action removes the ones that already exist.

A tag is also deleted when no directory on the default branch carries an `action.yml` at its name or at an ancestor of its name. This catches a removed action whose tags outlive it, and it catches branch tags of that removed action in the same pass.

A branch tag `<action>/<branch>#N` is deleted when the branch no longer exists on the remote. The branch the run is on is never swept, even when the remote list lags behind.

Tags without `#` are left alone and logged. Orphan-release never mints them, and a manually created tag may carry a meaning this action cannot know.

## Existence is judged by the default branch

The action fetches the default branch and reads its tree. The checkout is never consulted for what exists. A feature branch that deletes an action therefore cannot delete that action's tags on its own CI run. Only the default branch referees.

## Usage

The release workflow runs it on every push:

```yaml
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: wow-look-at-my/actions@tag-cleanup#latest
```

The checkout provides the authenticated `origin` remote the action pushes through, so it must come first. The job needs `contents: write` for the deletions.

Orphan-release runs this action from its `cleanup` input.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `dry-run` | No | `false` | Report stale tags without deleting them |

## Outputs

| Name | Description |
|------|-------------|
| `deleted-count` | Number of tags deleted (always 0 on a dry run) |
