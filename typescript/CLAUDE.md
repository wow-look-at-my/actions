# TypeScript Action

## Overview

Node.js action (TypeScript) that runs a user-supplied TypeScript snippet (inline via `script` or from a file via `file`), validating it with `tsc` first and pre-injecting helpers like `core`, `exec`, `$`, `context`, `octokit`, `fs`, `path`, etc. so scripts stay short.

## Structure

- `action.yml` — Action definition
- `globals.d.ts` — Ambient type declarations for injected helpers (`core`, `fs`, `octokit`, workflow contexts, etc.). Copied to `dist/` at build time and read at runtime.
- `src/index.ts` — TypeScript source (runs tsc, transpiles, executes via `AsyncFunction`)
- `justfile` — Build recipe (`just build`); the recipe also stages `dist/lib.*.d.ts` and `dist/types/node_modules/*` so the bundled `tsc` can resolve declarations at runtime
- `package.json` — Dependencies (no `scripts` section)

## Development

This is a Node.js action. Do NOT commit `dist/` or built JS files — CI builds and publishes via orphan release tags.

### Build

```sh
just build
```

The recipe runs `pnpm install`, `pnpm tsc`, `pnpm esbuild`, and then stages a curated subset of type definitions into `dist/types/node_modules/` plus the TypeScript standard libs (`lib.es*.d.ts`, no DOM/webworker) into `dist/`. These are needed at runtime so the bundled `tsc` can find type definitions.

### Key Details

- User script runs at the top level — it is prefixed with `globals.d.ts` (read from `dist/` at runtime) that declares the injected names (`core`, `fs`, etc.), but is NOT wrapped in a function. `import` statements and top-level `await` work naturally.
- Type-checking uses `module: ES2022` (for top-level `await` / `import` support) via `ts.createProgram` with a CompilerHost that serves the source from memory; everything else (lib files, type packages) is read from disk under `dist/`.
- Diagnostics are remapped: line numbers are adjusted by the globals-prefix line count so errors point at the user's script line, not the prefix.
- Transpilation uses `ts.transpileModule` with `module: CommonJS` (converting `import` to `require()`), then the JS is executed via `AsyncFunction` with all helpers passed as arguments.
- A custom `require` is supplied so the user can `require('@actions/core')` etc. and get the same instance the action uses; unknown modules fall through to Node's regular `require`, then to `$GITHUB_WORKSPACE/node_modules` so packages installed by a prior `npm ci` step are also available.
- `crypto` is NOT injected because `@types/node` declares `crypto` as a global (Web Crypto), and an ambient `declare const crypto: typeof import('crypto')` would clash. Users can `require('crypto')` for the Node module.
- `@actions/github` is shipped as a stripped stub (`Context` + `WebhookPayload` only). Full Octokit types weigh in at ~7 MB; the `octokit` factory is typed loosely (`rest: any`, etc.) instead.

### Testing

Run integration tests (requires `just build` first):

```sh
pnpm tsx --test src/index.test.ts
```

Tests cover: basic execution, top-level await, import + await, node built-in imports, error propagation, type errors, workflow contexts, and require of @actions modules.

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
