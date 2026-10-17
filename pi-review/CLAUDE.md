# Pi Review

## Overview

Composite GitHub Action that:

1. Writes `~/.pi/agent/models.json` and `~/.pi/agent/settings.json` to mirror the local pi setup.
2. Hands off to [`shaftoe/pi-coding-agent-action@v2`](https://github.com/shaftoe/pi-coding-agent-action), which uses the pi SDK programmatically.

Defaults: provider `llama-server` at `https://llama.pazer.ai/v1`, model `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` (Gemma 4 26B), reasoning enabled, thinking level `high`, context window `262144`, max tokens `16384`, compat flags `supportsDeveloperRole: false` and `supportsReasoningEffort: false` for the OpenAI-compatible llama-server endpoint.

The API key in the local `models.json` is a literal value. The action replaces it with an env var reference (default `LLAMA_API_KEY`) populated by `secret-server` over OIDC, so the literal key never lands in the repo.

## Why wrap shaftoe's action

Earlier iterations of this action invoked `pi -p` from a shell script. That approach was silent in CI because Node.js block-buffers `process.stdout` when it is not a TTY; pi's writes queued in the OS buffer until pi exited or the workflow was cancelled, so the action looked dead. Switching to `pi --mode json | jq` did not fix it - the buffering happens before the pipe.

`shaftoe/pi-coding-agent-action` uses the pi SDK directly (`createAgentSession` + `session.subscribe`), the same way opencode does. Thinking deltas are written to stdout as they arrive (visible in the CI log), text deltas are accumulated, and the response is posted as a PR comment via shaftoe's built-in GitHub extensions. Re-implementing that machinery in-tree would be hundreds of lines of TypeScript with its own bundle/build pipeline; delegating to a maintained external action is much cheaper.

## Structure

- `action.yml` - Action definition
- `configure.sh` - Generates `~/.pi/agent/models.json` and `~/.pi/agent/settings.json` mirroring the local config
- `review-prompt.md` - Default review prompt sent to the agent (overridable via the `prompt` input)

## How It Works

1. `secret-server` (optional, default on) sets env vars from the OIDC secret server. The user is expected to have a secret keyed `LLAMA_API_KEY` (or whatever `api-key-env` points to).
2. `actions/setup-node@v4` installs Node.js (default 24).
3. `configure.sh` writes `models.json` (provider/model config, with `apiKey` set to the env var name so pi resolves it at request time) and `settings.json` (default thinking level).
4. A shell step composes the review prompt from `review-prompt.md` and optional `additional-instructions`, writing it to `$GITHUB_OUTPUT`.
5. `shaftoe/pi-coding-agent-action@v2` runs the agent. It reads our `models.json`, finds the `llama-server` provider, streams the run to the log, and posts the response as a PR comment.

## Things this action does NOT do

- Pin the pi version. shaftoe's action bundles its own pi and tracks it via their release process.
- Pass `token` to shaftoe's action. The pi SDK reads `apiKey` from `models.json`, which is the env var name; pi resolves it from `process.env` at request time. Passing `token` explicitly would override that lookup with a literal.
- Restrict the tool allowlist. shaftoe's action does not expose `--tools` filtering. We instruct the model to stay read-only in the prompt.

## Development

Composite action with one shell script - no build step. Edit `action.yml`, `configure.sh`, or `review-prompt.md` directly. Ensure shell scripts have the executable bit set (`chmod +x *.sh`); git preserves it.

### Testing

No automated tests. Smoke-test by opening a PR on this repo with the `.github/workflows/pi-review.yml` workflow enabled.
