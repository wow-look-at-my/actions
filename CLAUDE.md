# GitHub Actions Monorepo

This repository contains reusable GitHub Actions.

## Structure

Each action lives in its own directory with an `action.yml` file:

- `action-validator/` - Composite action (YAML only)
- `branch-block/` - Composite action (shell script)
- `download-release-binary/` - Node.js action (TypeScript compiled to JS)
- `ghcr/` - Composite action (build, push, and prune container images on GHCR with 3 toggleable phases: login, build, push)
- `ghcr-prune/` - Node.js action (prune old GHCR package versions)
- `go-packages/` - Composite action (builds Go binaries and publishes multi-arch scratch container images to GHCR)
- `multicmd/` - Composite action (YAML only)
- `orphan-release/` - Composite action (shell script)
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `cache-size/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)

## Reusable Workflows

### `pr-preview`

The `pr-preview/` directory contains scripts for the reusable workflow at `.github/workflows/pr-preview.yml`. It is **not** a standard action (no `action.yml`) — callers use it via `uses: wow-look-at-my/actions/.github/workflows/pr-preview.yml@main`.

Because the workflow self-checkouts `wow-look-at-my/actions` at `github.job_workflow_sha` to run its scripts, `pr-preview/dist/` must be committed (exempted from `.gitignore`). Run `just build` inside `pr-preview/` after editing TypeScript sources and commit the result.

## Action Types

### Node.js Actions

Actions using `runs.using: node24` require:
- `package.json` with dependencies — **no `scripts` section** (enforced by `no-scripts-action`)
- TypeScript source in `src/`
- A `justfile` with a `build` recipe that runs `pnpm install`, `pnpm tsc`, and `pnpm esbuild`
- **Do NOT commit `dist/` or built JS files.** CI builds these automatically via `just build` and publishes them through orphan release tags.

### Composite Actions

Actions using `runs.using: composite` are pure YAML - no build step needed.

## CI

The release workflow (`release.yml`) handles Node.js actions by:
1. Auto-detecting which directories (at any depth) contain a `package.json`
2. Running `just build` to install deps, typecheck, and bundle
3. Validating `action.yml` (version field, runs.main exists)
4. Publishing via orphan release tags (excluding `src/`, `node_modules/`, `tsconfig.json`, `justfile`, `package.json`, `pnpm-lock.yaml`)

Composite actions are released directly without a build step.
