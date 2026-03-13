# Branch Block

## Overview

Composite GitHub Action (shell script) that blocks re-creation of merged branches via repository rulesets.

## Structure

- `action.yml` — Action definition with inputs and composite run step
- `branch-block.sh` — Bash script that calls the GitHub API to manage rulesets

## How It Works

The script uses `gh api` to interact with the GitHub Rulesets API:

1. Looks up an existing ruleset by name
2. If none exists, creates a new ruleset with a `creation` rule targeting the branch
3. If one exists, appends the branch pattern to the ruleset's include list (unless already present)

## Development

This is a composite action with a shell script — no build step is needed. Edit `action.yml` or `branch-block.sh` directly.

### Key details

- The script uses `set -euo pipefail` for strict error handling
- Branch patterns are stored as `refs/heads/<branch>` in the ruleset conditions
- The `GH_TOKEN` env var is set by the composite step from `github.token`
- All output is wrapped in a `::group::` for clean logs

### Testing

There are no automated tests. To test changes, trigger the action in a test repository with a merged PR workflow.
