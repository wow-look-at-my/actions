# Pi Review

## Overview

Composite GitHub Action that reviews PRs using opencode with a local LLM.

1. Passes provider/model config via `OPENCODE_CONFIG_CONTENT` env var.
2. Starts an MCP server (`mcp-server.mjs`) exposing exactly three tools: `get_pr_diff`, `add_review_comment`, `submit_review`.
3. Runs `opencode run` with bash/edit/write denied, so the model can only read code and post reviews.

Defaults: provider `llama-server` at `https://llama.pazer.ai/v1`, model `ggml-org/gemma-4-26B-A4B-it-GGUF:Q8_0` (Gemma 4 26B), context window `262144`, max tokens `16384`.

## Structure

- `action.yml` - Action definition (generates opencode config inline via node)
- `mcp-server.mjs` - Minimal stdio MCP server exposing PR review tools via the GitHub API
- `review-prompt.md` - Default review prompt (overridable via the `prompt` input)

## Security

The model has NO access to bash, edit, or write tools. It can only:
- Read files (opencode builtins: read, grep, glob, etc.)
- Call the three MCP tools which make scoped GitHub API requests

The MCP server only makes three specific GitHub API calls:
1. `GET /repos/{owner}/{repo}/pulls/{number}` (diff, via Accept: application/vnd.github.diff)
2. `POST /repos/{owner}/{repo}/pulls/{number}/comments` (inline review comment)
3. `POST /repos/{owner}/{repo}/pulls/{number}/reviews` (submit review verdict)

## Development

Composite action with a standalone MCP server -- no build step. Edit `action.yml`, `mcp-server.mjs`, or `review-prompt.md` directly.
