# Orphan Release

Create orphan tags from a directory. Orphan tags contain only the contents of the source directory with no git history.

## Usage

### Auto-generated tags (recommended)

Pass `--version` to auto-generate versioned + latest tags:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
```

This creates:
- `my-action#1` - versioned tag
- `my-action#latest` - latest alias

On non-main branches, tags include the branch name:
- `my-action/feature-branch#1`
- `my-action/feature-branch#latest`

### Explicit tags

Pass `--tags` to specify exact tag names:

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    tags: v1 v1.0.0
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | Yes | Source directory to package |
| `version` | No* | Version number for auto-generated tags |
| `tags` | No* | Space-separated explicit tag names |
| `exclude` | No | Space-separated patterns to exclude |
| `message` | No | Commit message (defaults to "Release {tag}") |

*Either `version` or `tags` is required.

## Examples

### Release a composite action

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
```

### Release a node action (exclude build artifacts)

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
    exclude: src node_modules tsconfig.json
```

### Use in a workflow

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
          version: 1
```
