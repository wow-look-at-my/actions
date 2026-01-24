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

### Pin to specific version

Pass `--version` to force a specific version:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
```

### Explicit tags

Pass `--tags` to specify exact tag names:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    tags: v1 v1.0.0
```

## Branch handling

On non-main branches, tags include the branch name:
- `my-action/feature-branch#1`
- `my-action/feature-branch#latest`

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | Yes | Source directory to package |
| `version` | No | Force specific version (otherwise auto-increments) |
| `tags` | No | Space-separated explicit tag names |
| `exclude` | No | Space-separated patterns to exclude |
| `message` | No | Commit message (defaults to "Release {tag}") |

## Examples

### Release with auto-increment

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
```

### Exclude build artifacts

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    exclude: src node_modules tsconfig.json
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
