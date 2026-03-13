# GitHub Actions

Reusable GitHub Actions.

## Actions

### [action-validator](action-validator/)

Validate `action.yml` and workflow files.

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
```

### [branch-block](branch-block/)

Add merged branches to a ruleset that blocks re-creation.

```yaml
- uses: wow-look-at-my/actions@branch-block#latest
  with:
    branch: ${{ github.head_ref }}
```

### [download-release-binary](download-release-binary/)

Download a platform-specific binary from a GitHub release.

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: owner/repo
    name: my-tool
    token: ${{ secrets.GITHUB_TOKEN }}
```

### [multicmd](multicmd/)

Run OS-specific commands without boilerplate if-checks.

```yaml
- uses: wow-look-at-my/actions@multicmd#latest
  with:
    unix: ./install.sh
    windows: .\install.ps1
```

### [no-scripts-action](no-scripts-action/)

Ensures package.json files do not contain scripts sections (use justfiles instead).

```yaml
- uses: wow-look-at-my/actions@no-scripts-action#latest
```

### [orphan-release](orphan-release/)

Create orphan tags from a directory with auto-incrementing versions.

```yaml
- uses: wow-look-at-my/actions@orphan-release#latest
  with:
    source: my-action
    exclude: src node_modules
```

Creates `my-action#1` + `my-action#latest`. Next release auto-increments to `my-action#2`.

### [smart-cache](smart-cache/)

Cache with change detection - only saves when files actually changed.

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: node_modules
    key: deps-${{ hashFiles('package-lock.json') }}
```

### [tag-runner](tag-runner/)

Tag runner images with branch/latest tags.

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```
