# GitHub Actions

Reusable GitHub Actions.

## Actions

### [Action Validator](action-validator/)

Validate GitHub Action action.yml files.

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
```

Type: Composite

### [Branch Block](branch-block/)

Add merged branches to a ruleset that blocks re-creation.

```yaml
- uses: wow-look-at-my/actions@branch-block#latest
  with:
    branch: # Branch name to block
```

Type: Composite

### [Cache Size](cache-size/)

Report disk usage breakdown of cached directories.

```yaml
- uses: wow-look-at-my/actions@cache-size#latest
  with:
    paths: # Directories to measure (newline or space separated)
```

Type: Node.js (node20)

### [Download Release Binary](download-release-binary/)

Download a platform-specific binary from a GitHub release.

```yaml
- uses: wow-look-at-my/actions@download-release-binary#latest
  with:
    repo: # Repository (owner/name) to download from
    token: # GitHub token for API authentication (e.g. github.token)
```

Type: Node.js (node20)

### [Multi-Command](multicmd/)

Run OS-specific commands in a single step without boilerplate if-checks.

```yaml
- uses: wow-look-at-my/actions@multicmd#latest
```

Type: Composite

### [No Scripts Check](no-scripts-action/)

Ensures package.json files do not contain scripts sections (use justfiles instead).

```yaml
- uses: wow-look-at-my/actions@no-scripts-action#latest
```

Type: Node.js (node20)

### [Orphan Release](orphan-release/)

Create orphan tags from a directory.

```yaml
- uses: wow-look-at-my/actions@orphan-release#latest
```

Type: Composite

### [Smart Cache](smart-cache/)

Cache with change detection - only saves when files actually changed.

```yaml
- uses: wow-look-at-my/actions@smart-cache#latest
  with:
    path: # Paths to cache (space-separated)
    key: # Cache key
```

Type: Node.js (node20)

### [Tag Runner Image](tag-runner/)

Tags runner images with branch/latest tags and triggers flush.

```yaml
- uses: wow-look-at-my/actions@tag-runner#latest
  with:
    token: # GitHub token with packages:write and actions:write permissions
```

Type: Node.js (node20)
