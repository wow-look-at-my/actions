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
- `pi-review/` - Composite action (PR review via pi coding agent with native extension)
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `cache-size/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)

## Reusable Workflows

GitHub requires reusable workflows (`on: workflow_call`) to live in `.github/workflows/` (not in subdirectories, not elsewhere -- see [actions/runner#2102](https://github.com/actions/runner/issues/2102)). These are distinct from the repo's own CI workflows but share the same directory.

- `.github/workflows/pr-management.yml` - Opens PRs for branches missing one, updates PRs behind their base. Uses the `typescript` action internally.
- `.github/workflows/publish-ghcr.yml` - Builds a Docker image from a Dockerfile, pushes to GHCR on the push branch (default: master), and prunes old versions. Downloads a build artifact (default: `go-build`) before building. Used by docker-updater, auto-anywhere, and buildhost.

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
