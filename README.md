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

Create orphan tags from a directory with auto-incrementing versions.

```yaml
- uses: wow-look-at-my-code/actions@orphan-release#1
  with:
    source: my-action
    exclude: src node_modules
```

Creates `my-action#1` + `my-action#latest`. Next release auto-increments to `my-action#2`.

### [tag-runner](tag-runner/)

Tag runner images with branch/latest tags.

```yaml
- uses: wow-look-at-my-code/actions@tag-runner#1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```
