# Pi Review

## Overview

Composite GitHub Action that reviews PRs using the pi coding agent with a local LLM.

1. Writes `~/.pi/agent/models.json` to configure the custom OpenAI-compatible provider.
2. Loads a native pi extension (`extension.ts`) that registers three tools: `get_pr_diff`, `add_review_comment`, `submit_review`.
3. Runs `pi --print` with built-in tools restricted to read-only (read, grep, find, ls).

Defaults: provider `llama-server` at `https://llama.pazer.ai/v1`, model `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` (Gemma 4 26B), context window `262144`, max tokens `16384`.

## Structure

- `action.yml` - Action definition (configures pi and runs the review)
- `extension.ts` - Pi extension registering three PR review tools via the GitHub API
- `review-prompt.md` - Default review prompt (overridable via the `prompt` input)

## Security

The model has NO access to bash, edit, or write tools. It can only:
- Read files (pi builtins: read, grep, find, ls)
- Call the three extension tools which make scoped GitHub API requests

The extension only makes three specific GitHub API calls:
1. `GET /repos/{owner}/{repo}/pulls/{number}` (diff, via Accept: application/vnd.github.diff)
2. `POST /repos/{owner}/{repo}/pulls/{number}/comments` (inline review comment)
3. `POST /repos/{owner}/{repo}/pulls/{number}/reviews` (submit review verdict)

## Development

Composite action with a TypeScript extension loaded via jiti (no build step). Edit `action.yml`, `extension.ts`, or `review-prompt.md` directly.
