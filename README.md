# GitHub Actions

Reusable GitHub Actions.

## Actions

### [Action Validator](action-validator/)

Validate GitHub Action action.yml files.

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
```

Type: Composite

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/action-validator/README.md
```

### [Branch Block](branch-block/)

Add merged branches to a ruleset that blocks re-creation.

```yaml
- uses: wow-look-at-my/actions@branch-block#latest
  with:
    branch: # Branch name to block
```

Type: Composite

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/branch-block/README.md
```

### [Cache Size](cache-size/)

Report disk usage breakdown of cached directories.

```yaml
- uses: wow-look-at-my/actions@cache-size#latest
  with:
    paths: # Directories to measure (newline or space separated)
```

Type: Node.js (node24)

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/cache-size/README.md
```

### [Download Release Binary](download-release-binary/)

Download a platform-specific binary from a GitHub release.

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: # Repository (owner/name) to download from
    token: # GitHub token for API authentication (e.g. github.token)
```

Type: Node.js (node24)

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/download-release-binary/README.md
```

### [Multi-Command](multicmd/)

Run OS-specific commands in a single step without boilerplate if-checks.

```yaml
- uses: wow-look-at-my/actions@multicmd#latest
```

Type: Composite

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/multicmd/README.md
```

### [No Scripts Check](no-scripts-action/)

Ensures package.json files do not contain scripts sections (use justfiles instead).

```yaml
- uses: wow-look-at-my/actions@no-scripts-action#latest
```

Type: Node.js (node24)

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/no-scripts-action/README.md
```

### [Orphan Release](orphan-release/)

Create orphan tags from a directory.

```yaml
- uses: wow-look-at-my/actions@orphan-release#latest
```

Type: Composite

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/orphan-release/README.md
```

### [Smart Cache](smart-cache/)

Cache with change detection - only saves when files actually changed.

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: # Paths to cache (space-separated)
    key: # Cache key
```

Type: Node.js (node24)

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/smart-cache/action.yml
```

### [Tag Runner Image](tag-runner/)

Tags runner images with branch/latest tags and triggers flush.

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: # GitHub token with packages:write and actions:write permissions
```

Type: Node.js (node24)

```
setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/tag-runner/action.yml
```
