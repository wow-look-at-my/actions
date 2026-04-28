# TypeScript

Run an inline TypeScript script with full `tsc` validation. Common helpers (`core`, `context`, `octokit`, `fs`, `path`, ...) and the workflow contexts (`github`, `env`, `runner`, ...) are pre-injected, so scripts stay short and stay typed.

## Usage

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    script: |
      core.info(`Event: ${context.eventName} on ${context.ref}`);
      const data = fs.readFileSync('package.json', 'utf-8');
      core.setOutput('version', JSON.parse(data).version);
```

To pass workflow contexts (so the script can read `github.event_name`, `vars.FOO`, etc.), forward them as JSON:

```yaml
- uses: wow-look-at-my/actions@typescript#latest
  with:
    github: ${{ toJSON(github) }}
    vars: ${{ toJSON(vars) }}
    runner: ${{ toJSON(runner) }}
    script: |
      core.info(`actor: ${github.actor}, runner: ${runner.os}`);
      core.info(`var BAR: ${vars.BAR}`);
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
| `github` | No | `{}` | GitHub workflow context as JSON (typically `${{ toJSON(github) }}`). |
| `env` | No | `{}` | env workflow context as JSON. |
| `runner` | No | `{}` | runner workflow context as JSON. |
| `job` | No | `{}` | job workflow context as JSON. |
| `steps` | No | `{}` | steps workflow context as JSON. |
| `needs` | No | `{}` | needs workflow context as JSON. |
| `vars` | No | `{}` | vars workflow context as JSON. |
| `secrets` | No | `{}` | secrets workflow context as JSON. |
| `inputs` | No | `{}` | inputs workflow context as JSON. |
| `strategy` | No | `{}` | strategy workflow context as JSON. |
| `matrix` | No | `{}` | matrix workflow context as JSON. |

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

Workflow contexts (each is parsed from the matching JSON input, defaulting to `{}`):

| Name | Notes |
|------|-------|
| `github` | The full workflow `github` context. |
| `env` | `Record<string, string>`. |
| `runner` | Typed shape: `os`, `arch`, `name`, `environment`, `tool_cache`, `temp`, `debug`. |
| `job` | Typed shape: `status`, optional `container` and `services`. |
| `steps` | `Record<step_id, { conclusion, outcome, outputs }>`. |
| `needs` | `Record<job_id, { result, outputs }>`. |
| `vars` | `Record<string, string>`. |
| `secrets` | `Record<string, string>`. |
| `inputs` | `Record<string, any>`. |
| `strategy` | Typed shape: `fail_fast`, `job_index`, `job_total`, `max_parallel`. |
| `matrix` | `Record<string, any>`. |

`require('module-name')` is also available — calls for `@actions/core|exec|io|github` and built-in Node modules return the same instance the action uses; everything else falls through to Node's regular resolver.

## Notes

- `crypto` is intentionally not injected because Node's global `crypto` (Web Crypto) conflicts with the `crypto` module's type. Use the global, or `require('crypto')` for the Node module.
- `octokit` is typed loosely (`rest: any`, `graphql: any`, ...) so the action stays small. For full Octokit types, write a separate Node action.
- The `script` is treated as the body of an `async function`, so top-level `await` and `return` work without ceremony.
