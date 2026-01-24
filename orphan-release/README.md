# Orphan Release

Create orphan tags from a directory. Orphan tags contain only the contents of the source directory with no git history.

## Usage

### Auto-increment (default)

Just specify the source - version auto-increments from existing tags:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
```

First release creates `my-action#1` and `my-action#latest`.
Next release creates `my-action#2` and updates `my-action#latest`.

### Custom tag name

Override the tag name (defaults to source directory):

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: plugins/my-plugin
    name: my-plugin
```

Creates `my-plugin#1` instead of `plugins/my-plugin#1`.

### Pin to specific version

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
```

## Branch handling

By default, tags don't include the branch name (for marketplace plugins).

With `--include-branch`, non-main branches get branch-prefixed tags:
- `my-action/feature-branch#1`
- `my-action/feature-branch#latest`

This is useful for GitHub Actions where you want separate tags per branch.

## Cleanup

Delete all tags for a deleted branch:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    cleanup-branch: ${{ github.event.ref }}
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | Yes* | Source directory to package |
| `name` | No | Tag name prefix (defaults to source directory) |
| `version` | No | Force specific version (otherwise auto-increments) |
| `exclude` | No | Space-separated patterns to exclude |
| `message` | No | Commit message (defaults to "Release {tag}") |
| `include-branch` | No | Include branch name in tags for non-main branches |
| `cleanup-branch` | No | Delete all tags for this branch (cleanup mode) |

*Not required when using `cleanup-branch`.

## Examples

### Release with auto-increment

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
```

### Release a GitHub Action (with branch tags)

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    exclude: src node_modules tsconfig.json
    include-branch: true
```

### Release a marketplace plugin (no branch tags)

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: plugins/my-plugin
    name: my-plugin
```

### Full workflow

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: wow-look-at-my-code/actions@orphan-release#1
        with:
          source: my-action
```
