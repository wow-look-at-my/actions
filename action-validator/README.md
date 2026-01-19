# Action Validator

Validate GitHub Action `action.yml` files using [action-validator](https://github.com/mpalmer/action-validator).

## Usage

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `files` | Glob pattern for action.yml files to validate | `*/action.yml` |

## Examples

### Validate all actions in subdirectories

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
```

### Validate specific files

```yaml
- uses: wow-look-at-my-code/actions/action-validator@v1
  with:
    files: 'my-action/action.yml'
```
