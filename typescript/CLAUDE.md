# TypeScript Action

## Overview

Node.js action (TypeScript) that runs a user-supplied TypeScript snippet (inline via `script` or from a file via `file`), validating it with `tsc` first and pre-injecting helpers like `core`, `exec`, `$`, `context`, `octokit`, `fs`, `path`, etc. so scripts stay short.

## Structure

- `action.yml` — Action definition
- `globals.d.ts` — Ambient type declarations for injected helpers (`core`, `fs`, `octokit`, workflow contexts, etc.). Copied to `dist/` at build time and read at runtime.
- `src/index.ts` — TypeScript source (runs tsc, transpiles, executes via `AsyncFunction`)
- `src/transform.ts` — Hoisting transform: splits the user script into module-scope statements (import/export, namespaces, `declare`s) and an `async function __main()` body, with a per-line source map for diagnostics
- `justfile` — Build recipe (`just build`); the recipe also stages `dist/lib.*.d.ts` and `dist/types/node_modules/*` so the bundled `tsc` can resolve declarations at runtime
- `package.json` — Dependencies (no `scripts` section)

## Development

This is a Node.js action. Do NOT commit `dist/` or built JS files — CI builds and publishes via orphan release tags.

### Build

```sh
just build
```

The recipe runs `pnpm install`, `pnpm tsc`, `pnpm esbuild`, and then stages a curated subset of type definitions into `dist/types/node_modules/` plus only the TypeScript standard libs in the `/// <reference lib="..." />` closure of `lib.es2022.d.ts` (seeded with any lib the staged types reference) into `dist/`. These are needed at runtime so the bundled `tsc` can find type definitions. The orphan release tag ships `dist/` verbatim, so the recipe stages nothing else: no compiler API declarations, no unused lib variants, no JS/source maps/READMEs from type packages, no `@types/node` ts5.6/ts5.7 fallback trees.

### Key Details

- The user script is split by `transformScript` (`src/transform.ts`): top-level `import`/`export` declarations — and other module-only statements (namespaces, `declare global`, `declare`-modified) — stay at real module scope, while the remaining statements become the body of `export async function __main()`. That gives every construct a legal home: a module allows import/export but not top-level `return` (TS1108); an async function body allows `await`/`return` but not import/export (TS1232). `return <value>` becomes the `result` output. A shebang first line is neutralized position-preservingly; a leading BOM is stripped.
  - `__main`'s return type is left to inference on purpose: an explicit non-void annotation (e.g. `Promise<unknown>`) makes a script that never returns a value trip TS2355 ("must return a value").
  - Known limitation: a hoisted exported declaration can't reference non-exported top-level bindings (they live inside `__main`) — tsc reports a clear, line-mapped error.
- Type-checking uses `module: ES2022` (for top-level `await` support) via `ts.createProgram` with a CompilerHost that serves two files from memory: the transformed user module and `globals.d.ts` (read from `dist/` at runtime) as its own global script file — so the injected names stay ambient and a user-level `import * as path ...` legally shadows them. Everything else (lib files, type packages) is read from disk under `dist/`. Syntactic/semantic diagnostics are scoped to the user's file.
- Diagnostics are remapped through the transform's per-line map (hoisting reorders lines, so a constant offset doesn't work); synthetic wrapper lines fall back to the nearest preceding user line.
- Transpilation uses `ts.transpileModule` with `module: CommonJS`, then the JS is executed via `AsyncFunction`. Running it executes the hoisted statements (imports become `require()` calls — `@actions/*` hit the seeded `require.cache`, so ESM imports get the action's own instances — and export initializers run, including `export const x = await ...`) and defines `__main` on `module.exports`; the action then calls `__main()` and JSON-encodes its resolved value as `result`. Injected helpers (`core`, `$`, `context`, etc.) are assigned to `globalThis` before invocation.
- A custom `require` is supplied so the user can `require('@actions/core')` etc. and get the same instance the action uses; unknown modules fall through to Node's regular `require`, then to `$GITHUB_WORKSPACE/node_modules` so packages installed by a prior `npm ci` step are also available.
- `crypto` is NOT injected because `@types/node` declares `crypto` as a global (Web Crypto), and an ambient `declare const crypto: typeof import('crypto')` would clash. Users can `require('crypto')` for the Node module.
- `@actions/github` is shipped as a stripped stub: the real `Context`/`WebhookPayload` declarations plus a hand-rolled `lib/github.d.ts` exposing the module's real surface (`context`, `getOctokit`) with octokit instances typed loosely. Full Octokit types weigh in at ~7 MB; the `octokit` instance and `getOctokit` factory are typed loosely (`rest: any`, etc.) instead.
- `octokit` is a pre-authenticated `OctokitInstance`. Its token comes from the `github-token` action input (default `${{ github.token }}`), read via `core.getInput('github-token')` in `run()` and threaded into `execute()` — NOT from `process.env.GITHUB_TOKEN`, which the runner does not set for action processes (reading env was the bug that left `octokit.rest.*` throwing `Parameter token or opts.auth is required`). It mirrors how `actions/github-script` obtains the automatic token. The instance is built lazily on first property access, so an empty token only throws if the script actually touches `octokit`. It is also callable as `octokit(token)` for backward compatibility (emits a `core.warning` deprecation notice). Use `getOctokit(token, options?)` as the clean factory for custom tokens.

### Testing

Run integration tests (requires `just build` first):

```sh
pnpm tsx --test src/index.test.ts
```

Tests cover: basic execution, top-level await, top-level `return` (bare + value-as-`result`-output, the TS1108 regression), top-level ESM `import`/`export` (the TS1232 regression — incl. import+return combined, default imports, `@actions/*` same-instance imports, top-level await in exported initializers, type-only import elision, and a `file:` input with a shebang), dynamic `import()`, `require` of node built-ins and @actions modules, error propagation, type errors (including diagnostic line mapping with and without hoisted imports), workflow contexts, and octokit auth — including the regression guard that the injected `octokit` is authenticated from the `github-token` input (env var `INPUT_GITHUB-TOKEN`) and NOT from `process.env.GITHUB_TOKEN`. `src/transform.test.ts` unit-tests the hoisting transform and its line map directly.

#### CI dogfood harness (`test/`)

`test/` holds a composite action (`test/action.yml`) that drives the *built* action end-to-end through `uses: ./typescript` with real `file:` inputs — the published surface the `src/*.test.ts` runner (which spawns `node dist/index.js` with `INPUT_SCRIPT`) does not exercise. It is invoked by the `test-typescript` job in `.github/workflows/release.yml` (which runs `just build` first, since `dist/` is not committed) and is never released — both `detect` in `release.yml` and `generate-readme.sh` skip `*/test/*`.

- `test/repro.ts` — top-level `import` + injected globals (`core`, `path`, `env`) + top-level `await` + a real global `fetch`. A green step proves it compiles under strict tsc and runs (the action exits non-zero on any tsc/runtime error).
- `test/repro2.ts` — top-level `export` + top-level `import` + top-level `return`, where the returned value (not the exported `VERSION`) must flow to the `result` output. The harness seeds a known `package.json` at the workspace root (the action's CWD, which `readFile("package.json")` resolves against) and asserts `result` equals that version.
- `test/repro3.ts` — the injected `octokit` must be authenticated out of the box from the `github-token` input (default `${{ github.token }}`) with NO `secrets:` plumbing and NO `getOctokit(...)` call. It makes a real `octokit.rest.repos.get(context.repo)` call and asserts `full_name` matches `context.repo`; an unauthenticated octokit throws `Parameter token or opts.auth is required` and fails the step. This exercises the `${{ github.token }}` input-default resolution end-to-end (the `src/*.test.ts` runner can only simulate it by setting `INPUT_GITHUB-TOKEN`). The `test-typescript` job grants `permissions: contents: read` for this call.

Smoke-test by running locally:

```sh
INPUT_SCRIPT='core.info("hello")' node dist/index.js
```

To exercise the `$` tagged template (safe command execution):

```sh
INPUT_SCRIPT='await $`echo ${"hello world"}`' node dist/index.js
```

`$` splits static template parts by whitespace. Interpolated values are passed as individual arguments (never shell-split). Arrays expand to multiple args; falsy values are skipped.

To exercise contexts:

```sh
INPUT_GITHUB='{"actor":"alice"}' INPUT_RUNNER='{"os":"Linux"}' INPUT_SCRIPT='core.info(github.actor + " on " + runner.os)' node dist/index.js
```
