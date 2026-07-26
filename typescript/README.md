# TypeScript

Run an inline TypeScript script with full `tsc` validation. Common helpers (`core`, `context`, `octokit`, `fs`, `path`, ...) and most workflow contexts (`github`, `runner`, `env`, `job`) are auto-injected with no configuration; the rest can be passed in when needed.

## Usage

The minimal call — `github`, `runner`, `env`, and `job` are auto-derived from the runner's environment, no input plumbing required:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    script: |
      core.info(`Event: ${github.event_name} on ${github.ref_name}`);
      core.info(`Runner: ${runner.os} ${runner.arch}`);
      const data = fs.readFileSync('package.json', 'utf-8');
      core.setOutput('version', JSON.parse(data).version);
```

Instead of inlining the script, you can point to a `.ts` file in the repo:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    file: .github/scripts/release.ts
```

The file path is resolved relative to `$GITHUB_WORKSPACE`. Its contents are treated exactly like an inline `script` — same compilation, same injected helpers (a shebang first line is tolerated).

## Authenticated API calls (`octokit`)

The injected `octokit` is **pre-authenticated out of the box** — no `secrets:` plumbing, no `getOctokit(...)` call. Use it directly:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    script: |
      const { data } = await octokit.rest.repos.get(context.repo);
      core.info(`Stars: ${data.stargazers_count}`);
```

The token comes from the `github-token` input, which defaults to the automatic `${{ github.token }}` (`GITHUB_TOKEN`). **You must still grant the matching `permissions:`** — the automatic token is read-only for many scopes, so a write call needs an explicit grant on the job:

```yaml
jobs:
  comment:
    permissions:
      pull-requests: write          # required for the createComment call below
    steps:
      - uses: wow-look-at-my/actions@typescript#latest
        with:
          script: |
            await octokit.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: 'Hello from the typescript action',
            });
```

To authenticate as something other than the automatic token — a PAT with broader scope, or a token for a different repo — pass it via `github-token`. It becomes the token for the injected `octokit` and the default for `getOctokit()`:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    github-token: ${{ secrets.MY_PAT }}
    script: |
      const { data } = await octokit.rest.repos.get({ owner: 'other-org', repo: 'other-repo' });
      core.info(data.full_name);
```

`getOctokit(token, options?)` is also injected, for building an extra client with a specific token inline.

## Running commands (`$`)

`$` is a tagged-template command runner (zx-style). Static parts of the template are split on whitespace; each interpolated value is passed as **exactly one argument** — never shell-split — so there is no quoting or injection footgun:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    script: |
      const msg = 'commit with spaces';
      await $`git commit -m ${msg}`;            // one arg, no quoting needed
      await $`git push origin ${github.ref_name}`;
```

Interpolation rules: a `string`/`number` becomes one argument, a `string[]` expands to multiple arguments, and a falsy value (`false`, `null`, `undefined`, `''`) is skipped (handy for conditional flags: ``$`ls ${verbose && '-l'}` ``).

### Capturing output

Awaiting a command resolves to a **`ProcessOutput`** — `{ stdout, stderr, exitCode }` plus a `toString()`. So capturing output is a one-liner, no `exec.exec(..., { listeners: { stdout } })` block:

```yaml
script: |
  const { stdout } = await $`git rev-parse HEAD`;
  core.info(`sha = ${stdout.trim()}`);

  // toString() returns stdout with one trailing newline trimmed, so a command
  // string-coerces inline:
  core.setOutput('branch', `${await $`git branch --show-current`}`);
```

`stdout`/`stderr` are the raw captured streams (untrimmed); `toString()` returns `stdout` with a single trailing newline (`\n` or `\r\n`) removed.

#### Parsing JSON output

`stdout` and `stderr` each carry a `.json()` helper, and the builder's `.stdout` / `.stderr` are themselves awaitable — so you can parse a stream straight off a command, no `(await ...)` wrapper needed:

```yaml
script: |
  const pkg  = await $`cat package.json`.stdout.json<{ version: string }>();
  core.setOutput('version', pkg.version);

  const meta = await $`some-cmd`.stderr.json();             // stderr too
  const sha  = await $`git rev-parse HEAD`.stdout.text();   // stdout string, trailing newline trimmed
```

For the very common "parse stdout" case there are terser aliases right on the builder — `.json()` and `.text()` (stdout-only):

```yaml
script: |
  const pkg = await $`cat package.json`.json<{ version: string }>();
  const sha = await $`git rev-parse HEAD`.text();
```

All of these run the command once and resolve straight to the value (a trailing newline is fine — `JSON.parse` ignores it), and they compose with the modifiers above: `await $`gh api ...`.env({ ... }).stdout.json()`.

You can also reach into the streams on the already-resolved result when you want the whole `ProcessOutput`:

```yaml
script: |
  const out = await $`some-cmd`;
  const data = out.stdout.json();
  core.info(`exit ${out.exitCode}`);
```

`await $`cmd`.stdout` works because the builder's `.stdout`/`.stderr` are *lazy* accessors — awaiting one runs the command and resolves to that stream (the same raw, untrimmed `OutputStream` as `(await $`cmd`).stdout`). That is what lets `.stdout.json()` chain off the un-awaited command directly, sidestepping the `(await fetch(url)).json()`-style precedence trap (`await` binds looser than `.`).

> **Note:** `stdout`/`stderr` are string-like objects (so they can carry `.json()`). Every ordinary string operation works — `.trim()`, `.split()`, `.includes()`, concatenation, template interpolation, `JSON.stringify`, and assigning to a `string` — but because the runtime value is a boxed `String`, `typeof` is `'object'` and a strict `stdout === 'literal'` is `false`. Use `stdout.trim()`, loose `==`, or `String(stdout)` if you need the primitive for a comparison.

### Exit codes and errors

By default a non-zero exit **throws** (the thrown error carries the captured `stdout`, `stderr`, and `exitCode`). Chain `.nothrow()` to handle the exit code yourself instead:

```yaml
script: |
  const { exitCode } = await $`git diff --quiet`.nothrow();
  core.setOutput('changed', String(exitCode !== 0));
```

### Modifiers

Chain these on the builder before awaiting (each returns a new builder):

| Modifier | Effect |
|----------|--------|
| `.input(data)` | Pipe a `string`/`Buffer` to the command's stdin. |
| `.cwd(dir)` | Run in `dir` instead of the current working directory. |
| `.silent()` | Don't stream stdout/stderr to the live log (still captured in the result). |
| `.env(vars)` | Merge/override environment variables for this command (layered over the current process env). |
| `.nothrow()` | Resolve even on a non-zero exit instead of throwing. |

```yaml
script: |
  // capture, override env, and feed stdin — all without leaving $
  const { stdout } = await $`gpg --clearsign`
    .input('release notes')
    .env({ GNUPGHOME: '/tmp/gnupg' })
    .cwd(env.GITHUB_WORKSPACE);
```

## Passing other workflow contexts

If the script needs contexts the runner doesn't expose to action processes (`vars`, `secrets`, `steps`, `needs`, `inputs`, `strategy`, `matrix`), pass them explicitly:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    vars: ${{ toJSON(vars) }}
    matrix: ${{ toJSON(matrix) }}
    script: |
      core.info(`region=${vars.AWS_REGION} node=${matrix.node}`);
```

(For an API token you do **not** need `secrets:` — use the `github-token` input as shown above.)

## How it works

1. The step log has two collapsed groups: `Compiling script` (everything below) and `Executing script` (your script's own output).
2. `Compiling script` opens by echoing the source, syntax-highlighted with ANSI color escapes (GitHub's log viewer renders them). If highlighting fails for any reason, the plain source is printed instead — it never fails the step.
3. The `script` is compiled as a TypeScript module: top-level `import`/`export` declarations stay at module scope, and the remaining statements become the body of an `async function` — so top-level `await` and `return` work without ceremony too. The transformed module is type-checked using the bundled TypeScript compiler with `strict: true`; any `tsc` error fails the step before any code runs.
4. The validated source is transpiled to JavaScript.
5. The module is evaluated in-process with the injected helpers in scope: imports/exports execute first (matching ESM import hoisting), then the rest of the script. The action runs as a fresh process per step, so nothing carries over between invocations.
6. If the script returns a value (top-level `return <value>`), it is JSON-serialized and exposed as the `result` output.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `script` | No | — | TypeScript source to execute. Mutually exclusive with `file`. |
| `file` | No | — | Path to a `.ts` file to execute (resolved relative to `$GITHUB_WORKSPACE`). Mutually exclusive with `script`. |
| `github-token` | No | `${{ github.token }}` | Token the injected `octokit` authenticates with (and the default token for `getOctokit()`). Defaults to the automatic `GITHUB_TOKEN`; override with a PAT for broader scope. The caller must still declare the matching `permissions:` for the token to be allowed to act. |
| `github` | No | auto | Override for the `github` context. By default derived from `$GITHUB_*` env vars + `$GITHUB_EVENT_PATH`. |
| `runner` | No | auto | Override for the `runner` context. By default derived from `$RUNNER_*` env vars. |
| `env` | No | `process.env` | Override for the `env` context. Defaults to the action process's full environment. |
| `job` | No | `{ status }` | Override for the `job` context. `job.container` and `job.services` are never exposed to action processes. |
| `vars` | No | `{}` | `vars` workflow context as JSON. Opt-in — the runner does not expose repo/org vars to action processes. |
| `secrets` | No | `{}` | `secrets` workflow context as JSON. Opt-in. |
| `inputs` | No | `{}` | `inputs` workflow context as JSON (reusable workflow / `workflow_dispatch`). |
| `steps` | No | `{}` | `steps` workflow context as JSON. |
| `needs` | No | `{}` | `needs` workflow context as JSON. |
| `strategy` | No | `{}` | `strategy` workflow context as JSON. |
| `matrix` | No | `{}` | `matrix` workflow context as JSON. |

### Why are some contexts opt-in?

`vars`, `secrets`, `steps`, `needs`, `inputs`, `strategy`, and `matrix` are runner-side only — they exist as `${{ ... }}` expression substitutions in your workflow YAML and never reach the action's child process as env vars or files. The action has no way to read them on its own. Pass `${{ toJSON(vars) }}` (or whichever) when the script needs them.

`github`, `runner`, `env`, and `job` are reconstructed from the standard env vars and the event-payload file ([all documented by GitHub](https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables)), so no plumbing is needed for those.

## Outputs

| Name | Description |
|------|-------------|
| `result` | JSON-encoded value returned by the script (only set if the script returns something). |

## Injected names

Always available inside the script:

| Name | Type | Source |
|------|------|--------|
| `core` | `typeof import('@actions/core')` | `@actions/core` |
| `exec` | `typeof import('@actions/exec')` | `@actions/exec` |
| `io` | `typeof import('@actions/io')` | `@actions/io` |
| `$` | tagged-template command runner → `ProcessOutput` (see [Running commands](#running-commands-)) | `@actions/exec`'s `getExecOutput` |
| `octokit` | pre-authenticated `Octokit` (loosely typed; also callable as `octokit(token)`, deprecated) | `@actions/github`'s `getOctokit(github-token)` |
| `getOctokit` | `(token, options?) => Octokit` | `@actions/github`'s `getOctokit` |
| `context` | `Context` (typed) | `@actions/github`'s `context`, hydrated from env |
| `fs` | `typeof import('fs')` | Node built-in |
| `path` | `typeof import('path')` | Node built-in |
| `os` | `typeof import('os')` | Node built-in |
| `child_process` | `typeof import('child_process')` | Node built-in |
| `util` | `typeof import('util')` | Node built-in |

Top-level ESM `import` works the same way: `import`s of `@actions/core|exec|io|github` and built-in Node modules (including `node:`-prefixed specifiers) resolve to the same instances the action uses. `require('module-name')` is also available — everything else falls through to Node's regular resolver, then to `$GITHUB_WORKSPACE/node_modules`, so packages installed by a prior `npm ci` / `npm install` step can be imported or required directly.

## Notes

- `crypto` is intentionally not injected because Node's global `crypto` (Web Crypto) conflicts with the `crypto` module's type. Use the global, `import { ... } from 'node:crypto'`, or `require('crypto')` for the Node module.
- `octokit` is pre-authenticated with the `github-token` input (default `${{ github.token }}`), so `octokit.rest.*` works without any `secrets:` plumbing. Calling it as `octokit(token)` still works but is deprecated (it logs a warning) — use the instance directly, or `getOctokit(token)` for a one-off custom-token client. If `github-token` resolves to empty, `octokit` is unauthenticated and the first API call throws `Parameter token or opts.auth is required`.
- `octokit` is typed loosely (`rest: any`, `graphql: any`, ...) so the action stays small. For full Octokit types, write a separate Node action. Top-level `import { context, getOctokit } from '@actions/github'` type-checks against a bundled stub with the module's real surface (`Context` fully typed, octokit instances loose) and resolves to the action's own module at runtime.
- Top-level `import`/`export`, top-level `await`, and top-level `return <value>` (→ the `result` output) all work together: module-scope statements (imports, exports, namespaces, `declare`s) are hoisted to real module scope and execute before the remaining statements, matching ESM import-hoisting semantics. An `import` may shadow an injected global of the same name.
- One limitation of the hoisting: an exported declaration can only reference imports, other module-scope declarations, and globals — not non-exported top-level `const`s/`function`s (those live in the async body). Violations fail type-checking with a clear error on the offending line.
