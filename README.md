# Action Validator

Validate GitHub Action `action.yml` and workflow files using [action-validator](https://github.com/mpalmer/action-validator).

## Which Schema Validates What

`action.yml` files go through `action-validator` itself. **Workflow files are validated against the live schemastore `github-workflow.json`**, fetched per run by `validate-workflows.mjs` (ajv), not against action-validator's own schema.

action-validator vendors its schema into a wasm blob (`@action-validator/core`). That blob is pinned at 0.6.0, and there is no newer release. The blob has fallen behind GitHub. It rejects generally-available permission scopes, `artifact-metadata` among them. A correct workflow therefore fails with `Additional property 'artifact-metadata' is not allowed`. Fetching the live schema keeps the check current. The alternative pins the check to whenever that wasm was last rebuilt.

A fetch failure is a hard error, never a skipped check. An empty glob is a clean no-op.

## Usage

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `actions` | Glob pattern for action.yml files to validate | `*/action.yml` |
| `workflows` | Glob pattern for workflow files to validate | `.github/workflows/*.yml` |

## Examples

### Validate all actions and workflows (default)

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
```

### Validate only actions

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
  with:
    workflows: ''
```

### Custom patterns

```yaml
- uses: wow-look-at-my/actions@action-validator#latest
  with:
    actions: 'actions/*/action.yml'
    workflows: '.github/workflows/ci.yml'
```
