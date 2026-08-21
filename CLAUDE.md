# GitHub Actions Monorepo

This repository contains reusable GitHub Actions.

## Structure

Each action lives in its own directory with an `action.yml` file:

- `action-validator/` - Composite action. `action.yml` files go through `action-validator`; **workflow files are validated against the LIVE schemastore `github-workflow.json`** (fetched per run, checked by `validate-workflows.mjs` via ajv) rather than action-validator's own. Its schema is vendored into a wasm blob (`@action-validator/core`, pinned at 0.6.0 with no newer release) that has fallen behind GitHub and rejects generally-available permission scopes -- `artifact-metadata` among them, which is what surfaced this. A fetch failure is a hard error, never a skipped check; an empty glob is a clean no-op.
- `ape-binfmt/` - Composite action (shell script). Registers the APE magic `MZqFpD` with `binfmt_misc` so the kernel execs an Actually Portable Executable directly, instead of every caller routing it through a shell by hand. The interpreter is `/bin/sh` because the APE's own header is the trampoline -- there is no loader to fetch. Its `verify` input execs the caller's binary through perl's raw `execve`, since bash and `execvp(3)` both retry under `/bin/sh` and would report success on a kernel that knows nothing about the format
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
- `orphan-release/` - Composite action (shell script). Its `dats/` suite covers the push behaviour: the numbered tag and `#latest` go in SEPARATE pushes, because GitHub applies one push in one ref transaction and a run that loses the race for that shared pointer would otherwise lose its own numbered tag with it. The suite pushes to local bare repositories, so it needs no token and no network
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `ste-lint/` - Node.js action (the mechanical subset of ASD-STE100 Simplified Technical English over prose files: sentence length, contractions, banned modal verbs, and semicolons FAIL; passive voice, noun clusters, complex verb tenses, paragraph length, and dictionary word choice (`src/ste100-banned-words.ts`, extracted from ASD's free PDF) only warn, because a heuristic that fails a build teaches people to route around the check -- see `docs/ste-lint-spec-mapping.md` for the full rule-by-rule mapping)
- `cache-size/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)
- `typescript/` - Node.js action (run an inline or file-based TypeScript script, tsc-validated, with injected helper globals; an inline `script:` carrying two or more consecutive `//`-only lines fails the step; `file:` inputs exempt)

Not an action directory, and never released as one:

- `shared/cache-xfer/` - NOT an action: the one copy of the cache-xfer wire format (key layout, envelope, pack/unpack), imported by cache-upload, cache-download, and cache-cleanup. See `docs/shared-sources.md`.

## Reusable Workflows

GitHub requires reusable workflows (`on: workflow_call`) to live in `.github/workflows/` (not in subdirectories, not elsewhere -- see [actions/runner#2102](https://github.com/actions/runner/issues/2102)). These are distinct from the repo's own CI workflows but share the same directory.

- `.github/workflows/publish-ghcr.yml` - Builds a Docker image from a Dockerfile, pushes to GHCR on the push branch (default: master), and prunes old versions. Restores the build fileset (default hand-off name: `go-build`) via `cache-download` before building — the producer job must have handed it off with `cache-upload` in the same run. Used by docker-updater, auto-anywhere, and buildhost.
- `.github/workflows/buildhost-preview.yml` - Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project and posts a sticky PR comment with the preview URL. Reuses `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` for the upload (tar.gz PUT, GitHub OIDC auth -- no static secret) and `wow-look-at-my/actions@typescript#latest` for the sticky comment (marker `<!-- pr-preview-buildhost -->`). PRs deploy to a `pr-<number>` branch, pushes to `branch/<ref-name>`; fork PRs are skipped (no OIDC token). This is the only PR-preview flavour maintained here -- GitHub Pages is not used. The extra README prose for this workflow lives in `.github/workflows/buildhost-preview.md` (appended verbatim by `generate-readme.sh`).

## Action Types

### Node.js Actions

Actions using `runs.using: node24` require:
- `package.json` with dependencies — **no `scripts` section** (enforced by `no-scripts-action`)
- TypeScript source in `src/`
- A `justfile` with a `build` recipe that runs `pnpm install`, `pnpm tsc`, and `pnpm esbuild` — `tsc` type-checks and emits the JavaScript, `esbuild` only bundles it (TypeScript is compiled once; esbuild never reads a `.ts` file)
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

The Node/pnpm/just setup (+ optional `just build`) that release.yml's jobs share lives in the internal composite action `.github/actions/setup-and-build/` — under `.github/`, so the detect job never releases it; checkout stays in each job because a local `uses: ./...` only resolves after checkout.
Tags are published from **master only** (branch pushes still build/test but never tag). Each action's numbered tag (`<name>#N`) auto-increments from the existing tags on each release, and `<name>#latest` is force-moved alongside it; an action whose content is unchanged since its `#latest` is skipped (no new tag). The `version:` field still present in some `action.yml` files is vestigial and no longer consumed.
