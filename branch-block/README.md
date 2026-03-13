# Branch Block

A composite GitHub Action that adds merged branches to a repository ruleset, preventing them from being re-created.

## How It Works

When a branch is merged, this action adds its name to a GitHub repository ruleset with a `creation` rule. This blocks anyone from pushing a new branch with the same name, keeping the branch namespace clean.

- If the ruleset doesn't exist yet, it creates one with the branch pattern.
- If the ruleset already exists, it appends the new branch pattern to the existing include list.
- If the branch pattern is already in the ruleset, it's a no-op.

## Usage

```yaml
- uses: wow-look-at-my/actions@branch-block#latest
  with:
    branch: ${{ github.head_ref }}
```

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `branch` | Yes | — | Branch name to block from being re-created |
| `ruleset` | No | `merged-branches` | Name of the ruleset to create or update |
| `token` | No | `github.token` | GitHub token with admin access to manage rulesets |

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
    steps:
      - uses: wow-look-at-my/actions@branch-block#latest
        with:
          branch: ${{ github.head_ref }}
          token: ${{ secrets.BRANCH_BLOCK_PAT }}
```

## Requirements

- **`BRANCH_BLOCK_PAT`**: This action requires the `BRANCH_BLOCK_PAT` org-wide secret — a Personal Access Token (PAT) with permission to manage repository rulesets. The default `GITHUB_TOKEN` does not have sufficient privileges to create or update rulesets. Set `BRANCH_BLOCK_PAT` as an organization-level secret so it is available to all repositories using this action.
- The repository must support rulesets (GitHub Free for public repos, GitHub Pro/Team/Enterprise for private repos).
