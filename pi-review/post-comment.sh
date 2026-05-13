#!/usr/bin/env bash
set -euo pipefail

if [ -z "${REVIEW:-}" ]; then
	echo "::warning::Review output is empty; skipping comment."
	exit 0
fi

comment_file=$(mktemp)
{
	echo "## Pi Code Review"
	echo
	printf '%s\n' "$REVIEW"
	echo
	echo "---"
	echo
	printf '*Reviewed by [pi-coding-agent](https://pi.dev) using `%s` at `%s`*\n' "$MODEL" "$ENDPOINT"
} > "$comment_file"

echo "::group::Post review comment on PR #$PR_NUMBER"
gh pr comment "$PR_NUMBER" --body-file "$comment_file"
echo "::endgroup::"
