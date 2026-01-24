# GitHub Actions

Reusable GitHub Actions.

## Actions

### [multicmd](multicmd/)

Run OS-specific commands without boilerplate if-checks.

```yaml
- uses: wow-look-at-my-code/actions@multicmd#1
  with:
    unix: ./install.sh
    windows: .\install.ps1
```

### [action-validator](action-validator/)

Validate `action.yml` and workflow files.

```yaml
- uses: wow-look-at-my-code/actions@action-validator#1
```

### [smart-cache](smart-cache/)

Cache with change detection - only saves when files actually changed.

```yaml
- uses: wow-look-at-my-code/actions@smart-cache#1
  with:
    path: node_modules
    key: deps-${{ hashFiles('package-lock.json') }}
```

### [orphan-release](orphan-release/)

Create orphan tag(s) from a directory with optional file transformations.

```yaml
# Explicit tags
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    tags: v1 v1.0.0
    exclude: src node_modules
    move: dist/index.js:index.js

# Auto-generate tags from version (creates name#version + name#latest)
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    version: 1
    exclude: src node_modules
```

### [tag-runner](tag-runner/)

Tag runner images with branch/latest tags.

```yaml
- uses: wow-look-at-my-code/actions@tag-runner#1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```
