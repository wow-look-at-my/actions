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

If the script needs contexts the runner doesn't expose to action processes (`vars`, `secrets`, `steps`, `needs`, `inputs`, `strategy`, `matrix`), pass them explicitly:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    secrets: ${{ toJSON(secrets) }}
    matrix: ${{ toJSON(matrix) }}
    script: |
      const oct = octokit(secrets.GITHUB_TOKEN);
      const { data } = await oct.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });
      core.info(`Stars: ${data.stargazers_count} (matrix.node=${matrix.node})`);
```

## How it works

1. The `script` input is wrapped in an async function and type-checked using the bundled TypeScript compiler with `strict: true`. Any `tsc` error fails the step before any code runs.
2. The validated source is transpiled to JavaScript.
3. The JS is executed in-process. The injected helpers are bound as parameters to the wrapping function, not as ambient globals — so they don't leak across runs.
4. If the script returns a value, it is JSON-serialized and exposed as the `result` output.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `script` | Yes | — | TypeScript source to execute. |
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
| `octokit` | `(token, options?) => Octokit` | `@actions/github`'s `getOctokit` |
| `context` | `Context` (typed) | `@actions/github`'s `context`, hydrated from env |
| `fs` | `typeof import('fs')` | Node built-in |
| `path` | `typeof import('path')` | Node built-in |
| `os` | `typeof import('os')` | Node built-in |
| `child_process` | `typeof import('child_process')` | Node built-in |
| `util` | `typeof import('util')` | Node built-in |

`require('module-name')` is also available — calls for `@actions/core|exec|io|github` and built-in Node modules return the same instance the action uses; everything else falls through to Node's regular resolver.

## Notes

- `crypto` is intentionally not injected because Node's global `crypto` (Web Crypto) conflicts with the `crypto` module's type. Use the global, or `require('crypto')` for the Node module.
- `octokit` is typed loosely (`rest: any`, `graphql: any`, ...) so the action stays small. For full Octokit types, write a separate Node action.
- The `script` is treated as the body of an `async function`, so top-level `await` and `return` work without ceremony.
