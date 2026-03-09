# Branch Block

A composite GitHub Action that adds merged branches to a repository ruleset, preventing them from being re-created.

## How It Works

When a branch is merged, this action adds its name to a GitHub repository ruleset with a `creation` rule. This blocks anyone from pushing a new branch with the same name, keeping the branch namespace clean.

- If the ruleset doesn't exist yet, it creates one with the branch pattern.
- If the ruleset already exists, it appends the new branch pattern to the existing include list.
- If the branch pattern is already in the ruleset, it's a no-op.

## Usage

```yaml
- uses: wow-look-at-my/actions/branch-block@main
  with:
    branch: ${{ github.head_ref }}
```

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `branch` | Yes | — | Branch name to block from being re-created |
| `ruleset` | No | `merged-branches` | Name of the ruleset to create or update |

### Example: Block branch after PR merge

```yaml
name: Block merged branches
on:
  pull_request:
    types: [closed]

jobs:
  block:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: wow-look-at-my/actions/branch-block@main
        with:
          branch: ${{ github.head_ref }}
```

## Requirements

- The `GITHUB_TOKEN` (provided automatically via `github.token`) must have permission to manage repository rulesets. This typically requires `contents: write` permission.
- The repository must support rulesets (GitHub Free for public repos, GitHub Pro/Team/Enterprise for private repos).
