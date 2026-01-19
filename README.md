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

### [tag-runner](tag-runner/)

Tag runner images with branch/latest tags.

```yaml
- uses: wow-look-at-my-code/actions/tag-runner@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```
