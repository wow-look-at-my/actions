# GitHub Actions

Reusable GitHub Actions.

## Actions

### [multicmd](multicmd/)

Run OS-specific commands without boilerplate if-checks.

```yaml
- uses: wow-look-at-my-code/actions/multicmd@v1
  with:
    unix: ./install.sh
    windows: .\install.ps1
```

### [action-validator](action-validator/)

Validate `action.yml` and workflow files.

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
```

### [smart-cache](smart-cache/)

Cache with change detection - only saves when files actually changed.

```yaml
- uses: wow-look-at-my-code/actions/smart-cache@v1
  with:
    path: node_modules
    key: deps-${{ hashFiles('package-lock.json') }}
```

### [orphan-tag](orphan-tag/)

Create orphan tag(s) from a directory with optional file transformations.

```yaml
- uses: wow-look-at-my-code/actions/orphan-tag@v1
  with:
    source: my-action
    tags: v1 v1.0.0
    exclude: src node_modules
    move: dist/index.js:index.js
```

### [orphan-tag-name](orphan-tag-name/)

Generate tag string in format `name@vN` or `name/branch@vN`.

```yaml
- uses: wow-look-at-my-code/actions/orphan-tag-name@v1
  id: tag
  with:
    path: my-action
- run: echo ${{ steps.tag.outputs.tag }}
```

### [tag-runner](tag-runner/)

Tag runner images with branch/latest tags.

```yaml
- uses: wow-look-at-my-code/actions/tag-runner@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```
