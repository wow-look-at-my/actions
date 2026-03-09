# GitHub Actions Monorepo

This repository contains reusable GitHub Actions.

## Structure

Each action lives in its own directory with an `action.yml` file:

- `action-validator/` - Composite action (YAML only)
- `branch-block/` - Composite action (shell script)
- `download-release-binary/` - Node.js action (TypeScript compiled to JS)
- `multicmd/` - Composite action (YAML only)
- `orphan-release/` - Composite action (shell script)
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)

## Action Types

### Node.js Actions

Actions using `runs.using: node20` require:
- `package.json` with dependencies
- TypeScript source compiled to `index.js`
- Run `npm run build` after changes and commit the output

### Composite Actions

Actions using `runs.using: composite` are pure YAML - no build step needed.

## CI

The CI workflow validates Node.js actions by:
1. Type checking with `tsc --noEmit`
2. Building with `npm run build`
3. Verifying `index.js` is up to date

Composite actions don't need CI validation beyond YAML syntax.
