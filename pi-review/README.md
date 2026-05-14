# Pi Review

Review a pull request using the [pi coding agent](https://github.com/earendil-works/pi-mono) with a local LLM. Defaults to Gemma 4 26B served by `llama.pazer.ai`. The API key is fetched at runtime via the `secret-server` action over OIDC.

The model gets read-only file access (read, grep, find, ls) plus three extension tools for GitHub PR reviews. Bash, edit, and write are denied.

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

Zero required inputs - the defaults match the configured setup.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `model` | `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` | Model ID at the configured endpoint. |
| `model-name` | `Gemma 4 26B` | Human-readable model name. |
| `endpoint` | `https://llama.pazer.ai/v1` | OpenAI-compatible base URL (include `/v1`). |
| `api-key-env` | `LLAMA_API_KEY` | Name of the env var holding the API key. |
| `provider` | `llama-server` | Provider identifier in pi's `models.json`. |
| `context-window` | `262144` | Context window size in tokens. |
| `max-tokens` | `16384` | Max output tokens. |
| `thinking` | `off` | Thinking level (off, minimal, low, medium, high, xhigh). |
| `prompt` | (uses `review-prompt.md`) | Override the review instructions. |
| `additional-instructions` | `` | Extra instructions appended to the review prompt. |
| `fetch-secrets` | `true` | Run `secret-server` first to populate API key env vars via OIDC. |
| `node-version` | `24` | Node.js version. |
| `github-token` | `github.token` | Token for PR access (reviews, comments, diff). |

## How it works

1. `secret-server` (optional) fetches secrets via OIDC and exports them to env.
2. `actions/setup-node` installs Node.js.
3. `@earendil-works/pi-coding-agent` is installed globally via npm.
4. `models.json` is written to `~/.pi/agent/` with provider config.
5. `pi --print` runs the review with built-in tools restricted to read-only. The extension (`extension.ts`) registers three tools: `get_pr_diff`, `add_review_comment`, `submit_review`.

## Extension Tools

The pi extension (`extension.ts`) registers exactly three tools:

| Tool | Description |
|------|-------------|
| `get_pr_diff` | Get the unified diff of the PR. |
| `add_review_comment` | Post an inline review comment on a specific diff line. |
| `submit_review` | Submit the final review verdict (APPROVE / REQUEST_CHANGES / COMMENT). |

No other GitHub API access is provided.
