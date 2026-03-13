# No Scripts Check Action

Ensures package.json files don't contain `scripts` sections. Use justfiles instead for better transparency and tooling.

## Usage

```yaml
- uses: PazerOP/actions/no-scripts-action@v1
```

### Check specific directory

```yaml
- uses: PazerOP/actions/no-scripts-action@v1
  with:
    path: ./packages
```

### Don't fail on violations

```yaml
- uses: PazerOP/actions/no-scripts-action@v1
  with:
    fail-on-violation: false
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `path` | Directory to check | `.` |
| `exclude` | Glob patterns to exclude (newline or comma separated) | `**/node_modules/**`, `**/.git/**` |
| `fail-on-violation` | Fail if scripts sections found | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `files-checked` | Number of package.json files checked |
| `files-with-scripts` | Number with scripts sections |
| `violation-list` | JSON array of violating files |
