# Action Validator

Validate GitHub Action `action.yml` and workflow files using [action-validator](https://github.com/mpalmer/action-validator).

## Usage

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `actions` | Glob pattern for action.yml files to validate | `*/action.yml` |
| `workflows` | Glob pattern for workflow files to validate | `.github/workflows/*.yml` |

## Examples

### Validate all actions and workflows (default)

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
```

### Validate only actions

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
  with:
    workflows: ''
```

### Custom patterns

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
  with:
    actions: 'actions/*/action.yml'
    workflows: '.github/workflows/ci.yml'
```
