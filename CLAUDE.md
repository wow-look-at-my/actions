# GitHub Actions Monorepo

This repository contains reusable GitHub Actions.

## Structure

Each action lives in its own directory with an `action.yml` file:

- `action-validator/` - Composite action (YAML only)
- `branch-block/` - Composite action (shell script)
- `cache-cleanup/` - Node.js action (deletes a run's cache hand-offs and sweeps aged ones)
- `cache-download/` - Node.js action (restores files handed off by cache-upload in the same run)
- `cache-upload/` - Node.js action (hands files to later jobs in the same run via the actions cache)
- `cloudflare-pages/` - Composite action (publish a directory to Cloudflare Pages by wrangler direct upload; credentials from secret-server via OIDC, green-warn no-op when unentitled)
- `download-release-binary/` - Node.js action (TypeScript compiled to JS)
- `ghcr/` - Composite action (build, push, and prune container images on GHCR with 3 toggleable phases: login, build, push)
- `ghcr-prune/` - Node.js action (prune old GHCR package versions)
- `multicmd/` - Composite action (YAML only)
- `no-all-builds-job/` - Node.js action (fails CI when any job is named all-builds — the recurring trick that shadows the org's required all-builds gate in the GitHub UI)
- `orphan-release/` - Composite action (shell script)
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `cache-size/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)
- `typescript/` - Node.js action (run an inline or file-based TypeScript script, tsc-validated, with injected helper globals)

## Reusable Workflows

GitHub requires reusable workflows (`on: workflow_call`) to live in `.github/workflows/` (not in subdirectories, not elsewhere -- see [actions/runner#2102](https://github.com/actions/runner/issues/2102)). These are distinct from the repo's own CI workflows but share the same directory.

- `.github/workflows/publish-ghcr.yml` - Builds a Docker image from a Dockerfile, pushes to GHCR on the push branch (default: master), and prunes old versions. Restores the build fileset (default hand-off name: `go-build`) via `cache-download` before building — the producer job must have handed it off with `cache-upload` in the same run. Used by docker-updater, auto-anywhere, and buildhost.
- `.github/workflows/buildhost-preview.yml` - Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project and posts a sticky PR comment with the preview URL. Reuses `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` for the upload (tar.gz PUT, GitHub OIDC auth -- no static secret) and `wow-look-at-my/actions@typescript#latest` for the sticky comment (marker `<!-- pr-preview-buildhost -->`). PRs deploy to a `pr-<number>` branch, pushes to `branch/<ref-name>`; fork PRs are skipped (no OIDC token). This is the buildhost flavour of the PR-preview pair; the GitHub Pages flavour lives in `pr-preview.yml`. The extra README prose for this workflow lives in `.github/workflows/buildhost-preview.md` (appended verbatim by `generate-readme.sh`).

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
3. Validating `action.yml` (runs.main exists)
4. Publishing via orphan release tags (excluding `src/`, `node_modules/`, `tsconfig.json`, `justfile`, `package.json`, `pnpm-lock.yaml`)

Composite actions are released directly without a build step.

Master publishes each action's plain tags: the numbered tag (`<name>#N`) auto-increments from the existing tags on each release, `<name>#latest` is force-moved alongside it (numbered tags are never force-pushed), and an action whose content is unchanged since its `#latest` is skipped (no new tag). Other branches publish per-branch **test tags** (`<name>/<branch>#N` / `<name>/<branch>#latest`, same auto-increment/dedup/no-force semantics within the branch namespace) — but only for actions whose published content differs from master's `<name>#latest`, so a branch push tags exactly the actions it changed and consumers can test them pre-merge via `uses: wow-look-at-my/actions@<name>/<branch>#latest`. `dependabot/*` branches never publish tags (their pushes still build and test). Branch tags are swept by the cleanup job once their branch is deleted. The `version:` field still present in some `action.yml` files is vestigial and no longer consumed.

## Tag/release system — do not redesign

The tag/release system (per-branch test tags, `#latest`, auto-incremented `#N`, release.yml + orphan-release) is deliberate and operator-owned.

- Do NOT remove, master-gate, or "simplify" any part of it as a side effect of another task. Per-branch tag publishing in particular is the sanctioned way to test an action before it merges — it stays.
- Never reference an unmerged action by commit SHA from another action or workflow. To consume in-progress action code, use `wow-look-at-my/actions@<action>/<branch>#latest`, or ask the operator to merge first.
- Changes to release.yml / orphan-release beyond a surgical, explicitly-requested bug fix require operator sign-off in the task itself. Propose in the PR body; do not self-authorize a redesign.
- History: branch tag publishing was removed once (PR #124, 2026-07-19) and had to be restored — do not repeat it.
