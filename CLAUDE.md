# GitHub Actions Monorepo

This repository contains reusable GitHub Actions.

## Structure

Each action lives in its own directory with an `action.yml` file:

- `action-validator/` - Composite action. `action.yml` files go through `action-validator`. **Workflow files go through the LIVE schemastore `github-workflow.json`** instead, fetched per run and checked by `validate-workflows.mjs` with ajv. The schema of action-validator is vendored into a wasm blob (`@action-validator/core`, pinned at 0.6.0 with no newer release). That blob has fallen behind GitHub. It rejects generally-available permission scopes, `artifact-metadata` among them. A fetch failure is a hard error, never a skipped check. An empty glob is a clean no-op.
- `branch-block/` - Composite action (shell script)
- `cache-cleanup/` - Node.js action (deletes a run's cache hand-offs and sweeps aged ones)
- `cache-download/` - Node.js action (restores files handed off by cache-upload in the same run)
- `cache-upload/` - Node.js action (hands files to later jobs in the same run via the actions cache)
- `cloudflare-pages/` - Composite action. It publishes a directory to Cloudflare Pages by wrangler direct upload. Credentials come from secret-server over OIDC. An unentitled identity gets a green-warn no-op.
- `download-release-binary/` - Node.js action (TypeScript compiled to JS)
- `ghcr/` - Composite action (build, push, and prune container images on GHCR with 3 toggleable phases: login, build, push)
- `ghcr-prune/` - Node.js action (prune old GHCR package versions)
- `multicmd/` - Composite action (YAML only)
- `no-all-builds-job/` - Node.js action (fails CI when any job is named all-builds — the recurring trick that shadows the org's required all-builds gate in the GitHub UI)
- `orphan-release/` - Composite action (shell script)
- `pi-review/` - Composite action (PR review via pi coding agent with native extension)
- `orphan-release/` - Composite action (shell script). Its `dats/` suite covers the push behaviour: the numbered tag and `#latest` go in SEPARATE pushes, because GitHub applies one push in one ref transaction and a run that loses the race for that shared pointer would otherwise lose its own numbered tag with it. The suite pushes to local bare repositories, so it needs no token and no network
- `orphan-release/` - Composite action (shell script). Its `dats/` suite covers the push behaviour. The numbered tag and `#latest` go in SEPARATE pushes. GitHub applies one push in one ref transaction. A run that loses the race for that shared pointer therefore loses its own numbered tag with it. The suite pushes to local bare repositories, so it needs no token and no network
- `smart-cache/` - Node.js action (TypeScript compiled to JS)
- `ste-lint/` - Node.js action (the mechanical subset of ASD-STE100 Simplified Technical English over prose files: sentence length, contractions, banned modal verbs, semicolons, and comma splices FAIL. Every rule reads a paragraph with its wrapped lines REJOINED (`src/blocks.ts`). Reading one physical line at a time cannot see a sentence, which left the length cap unenforceable on any hard-wrapped document. A finding still names the line its sentence starts on. A code span or a quotation is replaced by a same-length blank that opens with one letter. It counts as one word and can still open a sentence. Passing file arguments runs it as a local CLI. It reports its own `uses:` ref, and it FAILS on a step carrying `continue-on-error` (`src/guard.ts`). Neither word cap is settable ABOVE 25 (`src/inputs.ts`): rule 6.3 sets that number, so a larger one removes the rule instead of configuring it. The heuristics only warn. They are passive voice, noun clusters, complex verb tenses, paragraph length, and dictionary word choice (`src/ste100-banned-words.ts`, extracted from the free PDF of ASD). A heuristic that fails a build teaches people to route around the check. See `docs/ste-lint-spec-mapping.md` for the full rule-by-rule mapping)
- `ste-lint/` - Node.js action (the mechanical subset of ASD-STE100 Simplified Technical English over prose files: sentence length, contractions, banned modal verbs, semicolons, comma splices, and hard-wrapped paragraphs FAIL. A paragraph is ONE line: a wrap is one author's guess at one reader's window frozen into the file, so every later edit reflows the block and a two-word change becomes indistinguishable from a rewrite in the diff. That last rule is a house rule and claims no ASD rule number — the mapping doc says so rather than dressing it up as STE. Every rule reads a paragraph with its wrapped lines REJOINED (`src/blocks.ts`). Reading one physical line at a time cannot see a sentence, which left the length cap unenforceable on any hard-wrapped document. A finding still names the line its sentence starts on. A code span or a quotation is replaced by a same-length blank that opens with one letter, so it counts as one word and can still open a sentence. A quotation ends at the next quotation mark or at the next blank line, because pairing across a whole document put every later span at the wrong place. An appositive list is a finding, because a reader cannot tell a renamed noun from the next item. `fixtures/` keeps the prose that broke each of these rules, and `src/fixtures.test.ts` fails on a fixture whose header names no rule. Passing file arguments runs it as a local CLI. It reports its own `uses:` ref, and it FAILS on a step carrying `continue-on-error` (`src/guard.ts`). Neither word cap is settable ABOVE 25 (`src/inputs.ts`): rule 6.3 sets that number, so a larger one removes the rule instead of configuring it. The heuristics -- passive voice, noun clusters, complex verb tenses, paragraph length, and dictionary word choice (`src/ste100-banned-words.ts`, extracted from ASD's free PDF) -- only warn, because a heuristic that fails a build teaches people to route around the check -- see `docs/ste-lint-spec-mapping.md` for the full rule-by-rule mapping)
- `cache-size/` - Node.js action (TypeScript compiled to JS)
- `tag-runner/` - Node.js action (TypeScript compiled to JS)
- `yaml-comment-block/` - Node.js action (fails CI when a GHA YAML file carries more than 1 comment line in a row. It scans the whole local call chain. That means every workflow file, every `action.yml` at any depth, and everything they reach through `uses: ./...`. A `uses:` into another repository is listed in the log and checked where it lives. A block is a maximal group of comment lines separated only by blank lines. Paragraph breaks therefore do not split a wall, and a `#` inside a `run:` script counts. The limit is a constant with NO input that raises it. A settable maximum removes the rule instead of configuring it)
- `typescript/` - Node.js action. It runs an inline or file-based TypeScript script, tsc-validated, with injected helper globals. An inline `script:` carrying two or more consecutive `//`-only lines fails the step. A `file:` input is exempt.

`requests.json` records each owner instruction with a command that proves it, and `check-requests.mjs` runs them in the `requests` CI job. See `docs/requests.md`.

`docs/release-workflow.md` holds the reasoning behind release.yml's job comments. Those comments stay to one line and point at it.

Not an action directory, and never released as one:

- `shared/cache-xfer/` - NOT an action: the one copy of the cache-xfer wire format (key layout, envelope, pack/unpack), imported by cache-upload, cache-download, and cache-cleanup. See `docs/shared-sources.md`.

## Reusable Workflows

GitHub requires reusable workflows (`on: workflow_call`) to live in `.github/workflows/` (not in subdirectories, not elsewhere -- see [actions/runner#2102](https://github.com/actions/runner/issues/2102)). These are distinct from the repo's own CI workflows but share the same directory.

- `.github/workflows/publish-ghcr.yml` - Builds a Docker image from a Dockerfile, pushes to GHCR on the push branch (default: master), and prunes old versions. It restores the build fileset (default hand-off name: `go-build`) with `cache-download` before the build. The producer job must hand that fileset off with `cache-upload` in the same run. Used by docker-updater, auto-anywhere, and buildhost.
- `.github/workflows/buildhost-preview.yml` - Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project and posts a sticky PR comment with the preview URL. Reuses `wow-look-at-my/buildhost/.github/actions/buildhost-publish-site@master` for the upload (tar.gz PUT, GitHub OIDC auth -- no static secret) and `wow-look-at-my/actions@typescript#latest` for the sticky comment (marker `<!-- pr-preview-buildhost -->`). PRs deploy to a `pr-<number>` branch, pushes to `branch/<ref-name>`. Fork PRs are skipped, because they get no OIDC token. This is the only PR-preview flavour maintained here. GitHub Pages is not used. The extra README prose for this workflow lives in `.github/workflows/buildhost-preview.md` (appended verbatim by `generate-readme.sh`).

## Action Types

### Node.js Actions

Actions using `runs.using: node24` require:
- `package.json` with dependencies — **no `scripts` section** (enforced by `no-scripts-action`)
- TypeScript source in `src/`
- A `justfile` with a `build` recipe that runs `pnpm install`, `pnpm tsc`, and `pnpm esbuild`. `tsc` type-checks and emits the JavaScript. `esbuild` only bundles it. TypeScript is compiled once, and esbuild never reads a `.ts` file.
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

The Node, pnpm and just setup that release.yml's jobs share lives in the internal composite action `.github/actions/setup-and-build/`. It also runs `just build` on request. It sits under `.github/`, so the detect job never releases it. Checkout stays in each job, because a local `uses: ./...` only resolves after checkout.
Tags are published from **master only**. A branch push still builds and tests, but it never tags. Each action's numbered tag (`<name>#N`) auto-increments from the existing tags on each release. `<name>#latest` is force-moved alongside it. An action whose content is unchanged since its `#latest` is skipped, with no new tag. The `version:` field still present in some `action.yml` files is vestigial and no longer consumed.
