# TypeScript Action

## Overview

Node.js action (TypeScript) that runs a user-supplied TypeScript snippet, validating it with `tsc` first and pre-injecting helpers like `core`, `context`, `octokit`, `fs`, `path`, etc. so scripts stay short.

## Structure

- `action.yml` — Action definition
- `src/index.ts` — TypeScript source (wraps user code, runs tsc, transpiles, executes via `new Function(...)`)
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

- User script is wrapped in `async function __runUserScript() { ... }`, prefixed with an embedded `globals.d.ts` that declares the injected names (`core`, `fs`, etc.).
- Type-checking is done with `ts.createProgram` plus a CompilerHost that serves the wrapped source from memory; everything else (lib files, type packages) is read from disk under `dist/`.
- Diagnostics are remapped: line numbers are adjusted by the wrapper-prefix line count so errors point at the user's script line, not the wrapper.
- Transpilation uses `ts.transpileModule` with `module: CommonJS`, then the JS body is executed via `new Function(...)` with all helpers passed as arguments. This avoids polluting the global scope.
- A custom `require` is supplied so the user can `require('@actions/core')` etc. and get the same instance the action uses; unknown modules fall through to Node's regular `require`.
- `crypto` is NOT injected because `@types/node` declares `crypto` as a global (Web Crypto), and an ambient `declare const crypto: typeof import('crypto')` would clash. Users can `require('crypto')` for the Node module.
- `@actions/github` is shipped as a stripped stub (`Context` + `WebhookPayload` only). Full Octokit types weigh in at ~7 MB; the `octokit` factory is typed loosely (`rest: any`, etc.) instead.

### Testing

No automated tests. Smoke-test by running locally:

```sh
INPUT_SCRIPT='core.info("hello"); return { ok: true };' node dist/index.js
```

To exercise contexts:

```sh
INPUT_GITHUB='{"actor":"alice"}' INPUT_RUNNER='{"os":"Linux"}' INPUT_SCRIPT='core.info(github.actor + " on " + runner.os);' node dist/index.js
```
