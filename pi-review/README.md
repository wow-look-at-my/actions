# Pi Review

Review a pull request using the [pi coding agent](https://pi.dev). Defaults mirror the local `~/.pi/agent/` config: Gemma 4 26B served by `llama.pazer.ai` with thinking level `high`. The API key is fetched at runtime via the `secret-server` action over OIDC, so it never lands in the repo.

## Usage

```yml
name: PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  id-token: write  # required for secret-server OIDC

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - uses: wow-look-at-my/actions@pi-review#latest
```

Zero required inputs - the defaults match the configured pi setup. Pass overrides if you want a different model, endpoint, or thinking level.

The checkout step is recommended so pi can use `read`, `grep`, `find`, and `ls` to explore the codebase. Without it, pi only has the diff at `/tmp/pr.diff` to work from.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `model` | `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` | Model ID at the configured endpoint. |
| `model-name` | `Gemma 4 26B` | Human-readable model name. |
| `endpoint` | `https://llama.pazer.ai/v1` | OpenAI-compatible base URL (include `/v1`). |
| `api-key` | `LLAMA_API_KEY` | API key value, env var name, or `!shell command`. Env var names are resolved at request time. |
| `provider` | `llama-server` | Provider name registered in pi's `models.json`. |
| `thinking` | `high` | Thinking level. |
| `reasoning` | `true` | Whether the model supports extended thinking. |
| `tools` | `read,grep,find,ls` | Comma-separated pi tools. Read-only by default. |
| `context-window` | `262144` | Context window size in tokens. |
| `max-tokens` | `16384` | Max output tokens. |
| `pi-version` | `latest` | npm dist-tag or version of `@earendil-works/pi-coding-agent`. |
| `pr-number` | `github.event.pull_request.number` | PR number to review. |
| `post-comment` | `true` | Post the review as a PR comment when true. |
| `github-token` | `github.token` | Token used for `gh pr diff` and `gh pr comment`. |
| `additional-instructions` | `` | Extra instructions appended to the review prompt. |
| `fetch-secrets` | `true` | Run `secret-server` first to populate API key env vars via OIDC. |
| `node-version` | `24` | Node.js version (pi requires `>= 20.6.0`). |

## Outputs

| Output | Description |
|--------|-------------|
| `review` | Markdown review produced by pi. |

## Bringing your own endpoint

Override any default to point at a different OpenAI-compatible server:

```yml
- uses: wow-look-at-my/actions@pi-review#latest
  env:
    MY_API_KEY: ${{ secrets.MY_API_KEY }}
  with:
    model: gpt-oss-120b
    model-name: GPT-OSS 120B
    endpoint: https://my-llm.example.com/v1
    api-key: MY_API_KEY
    provider: my-llm
    fetch-secrets: 'false'
```

## How it works

1. `secret-server` (optional, default on) fetches secrets via OIDC and exports them to the env.
2. `actions/setup-node@v4` installs Node.js.
3. `@earendil-works/pi-coding-agent` is installed globally via npm.
4. `~/.pi/agent/models.json` is generated to match the local pi setup, with the API key replaced by an env var reference.
5. `~/.pi/agent/settings.json` is generated with the default thinking level.
6. The PR diff and metadata are written to `/tmp/pr.diff` and `/tmp/pr.json`.
7. `pi -p` runs with the review prompt and read-only tools. Output goes to `$GITHUB_OUTPUT` as `review`.
8. The review markdown is posted as a PR comment (unless `post-comment: false`).
