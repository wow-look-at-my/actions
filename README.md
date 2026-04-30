# Action Validator

Validate GitHub Action `action.yml` and workflow files using [action-validator](https://github.com/mpalmer/action-validator).

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
