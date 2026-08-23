# TypeScript Action

## Overview

Node.js action (TypeScript) that runs a user-supplied TypeScript snippet. The snippet arrives inline via `script` or from a file via `file`. The action validates it with `tsc` first. It pre-injects helpers like `core`, `exec`, `$`, `context`, `octokit`, `fs`, and `path`, so scripts stay short.

## Structure

- `action.yml` — Action definition
- `globals.d.ts` — Ambient type declarations for injected helpers (`core`, `fs`, `octokit`, workflow contexts, and more). Copied to `dist/` at build time and read at runtime.
- `src/index.ts` — TypeScript source (runs tsc, transpiles, executes via `AsyncFunction`)
- `src/comments.ts` — Comment-block gate for inline scripts. It finds runs of two or more consecutive `//`-only lines with the TypeScript scanner. A `//` inside a string, template literal or regex never counts. It reports each run's 1-based line span
- `src/transform.ts` — Hoisting transform: splits the user script into module-scope statements (import/export, namespaces, `declare`s) and an `async function __main()` body, with a per-line source map for diagnostics
- `src/highlight.ts` — ANSI syntax highlighter for the source echo that opens the `Compiling script` log group. It uses lowlight (highlight.js TypeScript grammar). It renders raw 24-bit SGR escapes with a GitHub-dark palette. The action emits the escapes unconditionally. The log is not a TTY, and chalk-style autodetection strips them. Every physical line is self-contained, because a multi-line token re-opens its color after each newline. The highlighter falls back to the plain source on any failure
- `justfile` — Build recipe (`just build`). The recipe also stages `dist/lib.*.d.ts` and `dist/types/node_modules/*` so the bundled `tsc` can resolve declarations at runtime
- `package.json` — Dependencies (no `scripts` section)

## Development

This is a Node.js action. Do NOT commit `dist/` or built JS files — CI builds and publishes via orphan release tags.

### Build

```sh
just build
```

The recipe runs `pnpm install`, `pnpm tsc`, and `pnpm esbuild`. It then stages a curated subset of type definitions into `dist/types/node_modules/`. It also stages only the TypeScript standard libs into `dist/`. Those libs are the `/// <reference lib="..." />` closure of `lib.es2022.d.ts`. The closure is seeded with any lib the staged types reference. These files are needed at runtime so the bundled `tsc` can find type definitions. The orphan release tag ships `dist/` verbatim, so the recipe stages nothing else. It stages no compiler API declarations and no unused lib variants. It stages no JS, no source maps, and no READMEs from type packages. It stages no `@types/node` ts5.6/ts5.7 fallback trees.

### Key Details

- The step log has exactly two groups: `Compiling script` (highlighted source echo, then `Type-check passed.` and `Transpiled output: N bytes`) and `Executing script`. The compile steps had a group each until their output was two lines total — three collapsibles to expand instead of one. The source is echoed FIRST inside the group. A throw in the transform then still leaves the script in the log. Type diagnostics land in the same group as the source they point at. Note that the runner separately echoes an inline `script:` input in its own step-input dump before the action starts. That copy belongs to the runner. Nobody can suppress it, format it, or merge into it. A `file:` input is the only way to shorten it.
- An INLINE `script:` carrying two or more consecutive comment-only lines fails the step (`findCommentBlocks`). The action logs one `core.error` per block, and each one names its line span. The check reads the RAW script. The reported lines are therefore user lines with no line map involved. The failure is DEFERRED. The comment errors are logged up front. The type-check and the script itself still run to completion. `core.setFailed()` only fires at the very end. A caller then sees the type-check result and the script's real output in the same run, instead of one error per re-run. A type-check or runtime error is a different failure mode. It still stops the step immediately, same as always. A `file:` input is exempt (`readUserScript` returns `inline`). It is ordinary checked-in source, commented like any other file in its repo. The gate is aimed at prose pasted into a workflow YAML. Only `//` is covered. A trailing comment after code is fine. A lone comment line is fine. Comment lines split by code or a blank line are fine too. There is no opt-out input for an inline script.
- The user script is split by `transformScript` (`src/transform.ts`). Top-level `import`/`export` declarations stay at real module scope. Other module-only statements stay there too: namespaces, `declare global`, and `declare`-modified statements. The remaining statements become the body of `export async function __main()`. That gives every construct a legal home. A module allows import/export but not top-level `return` (TS1108). An async function body allows `await`/`return` but not import/export (TS1232). `return <value>` becomes the `result` output. A shebang first line is neutralized position-preservingly. A leading BOM is stripped.
  - `__main`'s return type is left to inference on purpose: an explicit non-void annotation (e.g. `Promise<unknown>`) makes a script that never returns a value trip TS2355 ("must return a value").
  - Known limitation: a hoisted exported declaration cannot reference non-exported top-level bindings (they live inside `__main`) — tsc reports a clear, line-mapped error.
- Type-checking uses `module: ES2022` for top-level `await` support. It runs through `ts.createProgram` with a CompilerHost that serves two files from memory. The first file is the transformed user module. The second file is `globals.d.ts`, read from `dist/` at runtime, served as its own global script file. The injected names therefore stay ambient, and a user-level `import * as path ...` legally shadows them. Everything else (lib files, type packages) is read from disk under `dist/`. Syntactic/semantic diagnostics are scoped to the user's file.
- Diagnostics are remapped through the transform's per-line map. Hoisting reorders lines, so a constant offset does not work. Synthetic wrapper lines fall back to the nearest preceding user line.
- Transpilation uses `ts.transpileModule` with `module: CommonJS`, then the JS is executed via `AsyncFunction`. Running it executes the hoisted statements and defines `__main` on `module.exports`. Imports become `require()` calls. An `@actions/*` import hits the seeded `require.cache`, so ESM imports get the action's own instances. Export initializers run, including `export const x = await ...`. The action then calls `__main()` and JSON-encodes its resolved value as `result`. Injected helpers (`core`, `$`, `context`, and the rest) are assigned to `globalThis` before invocation.
- A custom `require` is supplied. The user can call `require('@actions/core')` and get the same instance the action uses. An unknown module falls through to Node's regular `require`. It then falls through to `$GITHUB_WORKSPACE/node_modules`. So packages installed by a prior `npm ci` step are also available.
- `crypto` is NOT injected because `@types/node` declares `crypto` as a global (Web Crypto), and an ambient `declare const crypto: typeof import('crypto')` clashes with it. Users can `require('crypto')` for the Node module.
- `@actions/github` is shipped as a stripped stub. The stub holds the real `Context`/`WebhookPayload` declarations. It adds a hand-rolled `lib/github.d.ts` that exposes the module's real surface (`context`, `getOctokit`) with octokit instances typed loosely. Full Octokit types weigh in at ~7 MB. So the `octokit` instance and the `getOctokit` factory are typed loosely (`rest: any`, and the like) instead.
- `octokit` is a pre-authenticated `OctokitInstance`. Its token comes from the `github-token` action input (default `${{ github.token }}`). The action reads it via `core.getInput('github-token')` in `run()` and threads it into `execute()`. The token does NOT come from `process.env.GITHUB_TOKEN`, which the runner does not set for action processes. Reading env was the bug that left `octokit.rest.*` throwing `Parameter token or opts.auth is required`. It mirrors how `actions/github-script` obtains the automatic token. The instance is built lazily on first property access, so an empty token only throws if the script actually touches `octokit`. It is also callable as `octokit(token)` for backward compatibility (emits a `core.warning` deprecation notice). Use `getOctokit(token, options?)` as the clean factory for custom tokens.

### Testing

Run integration tests (requires `just build` first):

```sh
pnpm tsx --test src/index.test.ts
```

Tests cover basic execution, top-level await, and top-level `return`. The `return` cases are the bare form and value-as-`result`-output, the TS1108 regression. Tests cover top-level ESM `import`/`export`, the TS1232 regression. That group includes import plus return combined, default imports, and `@actions/*` same-instance imports. It also includes top-level await in exported initializers, type-only import elision, and a `file:` input with a shebang. Tests cover dynamic `import()`, plus `require` of node built-ins and @actions modules. Tests cover error propagation and type errors, including diagnostic line mapping with and without hoisted imports. Tests cover workflow contexts and octokit auth. That includes the regression guard that the injected `octokit` is authenticated from the `github-token` input (env var `INPUT_GITHUB-TOKEN`). The guard also proves it is NOT authenticated from `process.env.GITHUB_TOKEN`. The `$ command runner` describe block covers the `ProcessOutput` result. That part covers stdout/stderr/exitCode capture, `toString()` trimming, and template-literal coercion. It covers `stdout`/`stderr` `.json()` parsing, untyped, type-parameterized, and on stderr. It adds a guard that a stream still behaves as a string (methods, coercion, `JSON.stringify`, assignability to `string`). It covers the paren-free builder shortcuts `.json()`/`.json<T>()`/`.text()`, including composing with a chained `.env()`. It covers the lazy awaitable stream accessors. Those are `await $\`...\`.stdout.json()` and `.stderr.json()`. They also include `await $\`...\`.stdout` resolving to the raw stream, `.stdout.text()` trimming, and `.stdout.json()` composing with a chained modifier. It covers throw-on-non-zero, and the thrown error carrying captured output. It covers `.nothrow()` and `.env()` merge-over-process-env. It covers argument interpolation: single-arg, array-expansion, and falsy-skip, with no shell split. It covers `.input()`/`.cwd()`/`.silent()` plus modifier chaining. `src/transform.test.ts` unit-tests the hoisting transform and its line map directly. `src/comments.test.ts` unit-tests the comment-block gate (spans, multiple blocks, singles/trailing/blank-separated comments allowed, `//` in strings/templates/regexes ignored, CRLF, JSDoc, shebang). `src/highlight.test.ts` unit-tests the ANSI highlighter (scope colors, per-line self-containment of multi-line tokens, escape-stripping round-trip, plain-text fallback on an unknown language). The `runAction` helper strips the echoed script source from `stdout`. It strips from the `::group::Compiling script` line up to the first `Type-check passed.`/`::error::` line. So the group's own output and any diagnostics survive for tests that assert on them. The raw text is kept verbatim in `rawStdout`. Execution assertions are therefore not satisfied by the mere echo of the script text.

#### CI dogfood harness (`test/`)

`test/` holds a composite action (`test/action.yml`). It drives the *built* action end-to-end through `uses: ./typescript` with real `file:` inputs. That is the published surface the `src/*.test.ts` runner does not exercise. That runner spawns `node dist/index.js` with `INPUT_SCRIPT`. The `test-typescript` job in `.github/workflows/release.yml` invokes the composite action. That job runs `just build` first, since `dist/` is not committed. The composite action is never released. Both `detect` in `release.yml` and `generate-readme.sh` skip `*/test/*`.

- `test/repro.ts` — top-level `import` + injected globals (`core`, `path`, `env`) + top-level `await` + a real global `fetch`. A green step proves it compiles under strict tsc and runs (the action exits non-zero on any tsc/runtime error).
- `test/repro2.ts` — top-level `export` + top-level `import` + top-level `return`, where the returned value (not the exported `VERSION`) must flow to the `result` output. The harness seeds a known `package.json` at the workspace root (the action's CWD, which `readFile("package.json")` resolves against) and asserts `result` equals that version.
- `test/repro3.ts` — the injected `octokit` must be authenticated out of the box from the `github-token` input (default `${{ github.token }}`) with NO `secrets:` plumbing and NO `getOctokit(...)` call. It makes a real `octokit.rest.repos.get(context.repo)` call and asserts `full_name` matches `context.repo`. An unauthenticated octokit throws `Parameter token or opts.auth is required` and fails the step. This exercises the `${{ github.token }}` input-default resolution end-to-end (the `src/*.test.ts` runner can only simulate it by setting `INPUT_GITHUB-TOKEN`). The `test-typescript` job grants `permissions: contents: read` for this call.
- `test/action.yml`'s `outcome-gate` steps — these prove the Jenkins-style "keep the job running, fail it at the end" pattern for callers. A `continue-on-error: true` step's `outcome` still reports `failure`. The `continue-on-error` setting masks its `conclusion` to `success`. So a later gate step can key its own `if:` off `steps.<id>.outcome` directly, with no intermediate env var needed. That gate step can then `exit 1` to fail the job without aborting it early. The check uses `continue-on-error: true` plus a `test "${{ steps.outcome-gate.outcome }}" = "failure"` assertion. That is the same proof-of-failure shape `release.yml`'s `test-no-all-builds-job` job uses.

Smoke-test by running locally:

```sh
INPUT_SCRIPT='core.info("hello")' node dist/index.js
```

To exercise the `$` tagged template (safe command execution):

```sh
INPUT_SCRIPT='const { stdout } = await $`echo ${"hello world"}`; core.info(stdout.trim())' node dist/index.js
```

`$` splits static template parts by whitespace. Interpolated values are passed as individual arguments (never shell-split). Arrays expand to multiple args. Falsy values are skipped.

Awaiting `$` resolves to a `ProcessOutput` (`{ stdout, stderr, exitCode, toString() }`). It is implemented on top of `@actions/exec`'s `getExecOutput`. `toString()` returns `stdout` with a single trailing newline trimmed. The `stdout`/`stderr` properties are the raw captured streams. A non-zero exit throws by default. The thrown `ProcessError` carries `stdout`/`stderr`/`exitCode`. `$` always runs the child with `ignoreReturnCode` and makes the throw decision itself. So output is captured even on failure. The chainable modifiers are `.input()`, `.cwd()`, `.silent()`, `.env()`, and `.nothrow()`. `.env()` merges over `process.env`. `@actions/exec` replaces rather than merges the env, so the builder seeds from the current env. `.nothrow()` resolves instead of throwing. Each modifier returns a fresh builder.

`stdout`/`stderr` are not plain strings. Each one is a boxed `String` (via `makeStream`) that carries a `.json()` helper. So `(await $\`...\`).stdout.json()` parses the captured output. `JSON.parse` tolerates a trailing newline. They are typed `OutputStream = string & { json<T = any>(): T }`. So they stay assignable to `string`, and every string method and coercion keeps working. The only caveat is the boxing. `typeof` is `'object'`. A strict `=== 'literal'` is `false`. Use `.trim()`, loose `==`, or `String(...)` instead. The injected `$` global is unchanged. The boxing happens in the `ProcessOutput` constructor.

The builder also exposes lazy stream accessors, so the chained form works without a `(await ...)` wrapper. `get stdout()` and `get stderr()` each return a `StreamPromise`. That is a `PromiseLike<OutputStream>` with `.json<T>()` and `.text()`. Awaiting one runs the command (`this.run()`) and resolves to that stream. `.json()` and `.text()` are paren-free terminals. This defeats the `await`-precedence trap. `await $\`x\`.stdout.json()` parses as `await ($\`x\`.stdout.json())`. But `.stdout` on the un-awaited builder is now a `StreamPromise` whose `.json()` returns a `Promise`. So it Just Works. This fixes the `(await fetch()).json()` gotcha. `.text()` trims a single trailing newline. It uses the shared `trimTrailingNewline` helper, which `ProcessOutput.toString()` also uses. `await $\`x\`.stdout` resolves to the raw, untrimmed `OutputStream`. Terser stdout-only aliases `.json()`/`.text()` sit directly on the builder and just delegate to `this.stdout`. Everything composes with the chained modifiers (`await $\`x\`.env({...}).stdout.json()`). The `.stdout.json()` / `.stderr.json()` forms on the resolved `ProcessOutput` still work when you already have the full result.

To exercise contexts:

```sh
INPUT_GITHUB='{"actor":"alice"}' INPUT_RUNNER='{"os":"Linux"}' INPUT_SCRIPT='core.info(github.actor + " on " + runner.os)' node dist/index.js
```
