# Pi Review

Review a pull request using the [pi coding agent](https://pi.dev). Defaults mirror the local `~/.pi/agent/` config: Gemma 4 26B served by `llama.pazer.ai` with thinking level `high`. The API key is fetched at runtime via the `secret-server` action over OIDC, so it never lands in the repo.

This action is a thin composite wrapper around [`shaftoe/pi-coding-agent-action`](https://github.com/shaftoe/pi-coding-agent-action). The wrapper writes a `~/.pi/agent/models.json` matching the configured local pi setup, then hands off to shaftoe's action, which runs pi via the SDK (not the CLI) so streaming output works correctly in CI. shaftoe's action also handles posting the response as a PR comment automatically.

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

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `model` | `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` | Model ID at the configured endpoint. |
| `model-name` | `Gemma 4 26B` | Human-readable model name registered in `models.json`. |
| `endpoint` | `https://llama.pazer.ai/v1` | OpenAI-compatible base URL (include `/v1`). Passed to shaftoe's action as `base_url`. |
| `api-key-env` | `LLAMA_API_KEY` | Name of the env var holding the API key; the models.json `apiKey` field references this name and pi resolves it at request time. |
| `provider` | `llama-server` | Provider name registered in pi's `models.json`. |
| `thinking` | `high` | Thinking level (off, minimal, low, medium, high, xhigh). |
| `reasoning` | `true` | Whether the model supports extended thinking. |
| `context-window` | `262144` | Context window size in tokens. |
| `max-tokens` | `16384` | Max output tokens. |
| `prompt` | (uses `review-prompt.md`) | Override the review instructions sent to the agent. |
| `additional-instructions` | `` | Extra instructions appended to the review prompt. |
| `fetch-secrets` | `true` | Run `secret-server` first to populate API key env vars via OIDC. |
| `node-version` | `24` | Node.js version (pi requires `>= 20.6.0`). |
| `github-token` | `github.token` | Token forwarded to shaftoe's action for PR access and comment posting. |
| `load-builtin-extensions` | `true` | Whether shaftoe's action loads its built-in GitHub extensions (`get_pr_diff`, `get_thread`, `update_pr`, `create_pr`). |

## Outputs

Forwarded from shaftoe's action:

| Output | Description |
|--------|-------------|
| `response` | The agent's response text. |
| `success` | `true` if pi completed successfully. |
| `input-tokens` | Input tokens consumed. |
| `output-tokens` | Output tokens generated. |
| `duration-seconds` | Wall-clock duration of pi execution. |

shaftoe's action posts the response as a PR comment automatically when running on a `pull_request` event; the output is also available for downstream steps.

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
    api-key-env: MY_API_KEY
    provider: my-llm
    fetch-secrets: 'false'
```

## How it works

1. `secret-server` (optional, default on) fetches secrets via OIDC and exports them to the env. Specifically, the env var named by `api-key-env` is set.
2. `actions/setup-node@v4` installs Node.js.
3. `configure.sh` writes `~/.pi/agent/models.json` (mirroring the local pi setup) and `~/.pi/agent/settings.json` (`defaultThinkingLevel`). The `apiKey` field in `models.json` is the env var name, not the literal key - pi resolves it at request time so the key never lands on disk.
4. A shell step composes the final prompt from `review-prompt.md` plus any `additional-instructions`.
5. `shaftoe/pi-coding-agent-action@v2` runs pi via the pi SDK. It streams thinking deltas to the runner log, accumulates the assistant response, and posts the response as a PR comment with metadata.

## Why this wraps shaftoe's action

Earlier iterations of this action invoked `pi -p` directly via the CLI from a shell script. That approach was silent in CI because Node.js block-buffers stdout when it is not a TTY; pi's text output sat in the OS buffer until pi exited or the job was cancelled, leaving the action looking dead. Shaftoe's action uses the pi SDK programmatically (`createAgentSession`, `session.subscribe(event => ...)`) and streams text/thinking deltas to the log as they arrive, the same way opencode does. Rather than re-implement that machinery, this action mirrors the local pi config into `~/.pi/agent/` and delegates the heavy lifting.
