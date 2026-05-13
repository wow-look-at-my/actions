#!/usr/bin/env bash
set -euo pipefail

if [ -z "${REVIEW:-}" ]; then
	echo "::error::REVIEW output is empty; refusing to post an empty comment. The previous step should have failed - check why it did not."
	exit 1
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
