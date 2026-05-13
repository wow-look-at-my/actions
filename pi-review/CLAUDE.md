# Pi Review

## Overview

Composite GitHub Action that runs the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) CLI in print mode (`pi -p`) to review a pull request.

Defaults mirror the local pi setup in `~/.pi/agent/`:

- Provider `llama-server` at `https://llama.pazer.ai/v1`
- Model `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` ("Gemma 4 26B"), reasoning enabled
- Thinking level `high`
- Context window `262144`, max tokens `16384`
- `compat.supportsDeveloperRole: false`, `compat.supportsReasoningEffort: false`

The API key in the local `models.json` is a literal value. The action replaces it with an env var reference (default `LLAMA_API_KEY`) populated by the `secret-server` step, so the key never lands in the repo.

## Structure

- `action.yml` - Action definition
- `configure.sh` - Generates `~/.pi/agent/models.json` and `~/.pi/agent/settings.json`
- `run-review.sh` - Fetches PR diff/metadata into `/tmp/pr.{diff,json}` and runs `pi -p`
- `post-comment.sh` - Posts the review markdown as a PR comment via `gh`
- `review-prompt.md` - Static review prompt template

## How It Works

1. `secret-server` (optional, default on) sets env vars from the OIDC secret server. The user is expected to have a secret keyed `LLAMA_API_KEY` (configurable).
2. `actions/setup-node@v4` installs Node.js (default 24).
3. `npm install -g @earendil-works/pi-coding-agent@<version>` installs pi.
4. `configure.sh` writes both `models.json` (provider/model config) and `settings.json` (default thinking level). The `apiKey` field is passed through verbatim - pi resolves env var names, `!shell command` values, and literal keys at request time.
5. `run-review.sh` calls `gh pr view`/`gh pr diff` to capture metadata and the unified diff, then invokes pi with `--no-session --no-extensions --no-skills --no-prompt-templates --offline` and a read-only `--tools` allowlist.
6. `post-comment.sh` posts the review as a `gh pr comment`.

## Tools Allowlist

Default is `read,grep,find,ls` - pi can read files and search but cannot write, edit, or shell out. Override via the `tools` input if richer analysis is needed.

## Diverging from local config

Anything in the local pi config that the action does NOT mirror:

- `~/.pi/agent/auth.json` - OAuth credentials for built-in providers (unused since we're using a custom provider with an API key)
- `~/.pi/agent/mcp.json`, `mcp-cache.json`, `mcp-onboarding.json` - MCP config (pi disables MCP and we pass `--no-extensions`)
- `~/.pi/agent/sessions/`, `run-history.jsonl` - session state (we pass `--no-session`)
- `settings.json` packages array - installed pi packages (we pass `--no-extensions --no-skills --no-prompt-templates` so installed packages have no effect)

If a future task needs any of these, extend `configure.sh`.

## Development

Composite action with shell scripts - no build step. Edit `action.yml` or the `.sh` / `.md` files directly. Make sure shell scripts have the executable bit set (`chmod +x *.sh`); git preserves it.

### Testing

There are no automated tests. To smoke-test locally:

```sh
export GH_TOKEN=...
export PR_NUMBER=123
export PROVIDER=llama-server
export ENDPOINT=https://llama.pazer.ai/v1
export MODEL='ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0'
export MODEL_NAME='Gemma 4 26B'
export API_KEY=LLAMA_API_KEY
export LLAMA_API_KEY=...    # actual key
export CONTEXT_WINDOW=262144
export MAX_TOKENS=16384
export REASONING=true
export DEFAULT_THINKING=high
export THINKING=high
export TOOLS=read,grep,find,ls
export PROMPT_PATH=$(pwd)/pi-review/review-prompt.md
npm install -g @earendil-works/pi-coding-agent@latest
./pi-review/configure.sh
./pi-review/run-review.sh
```
