#!/usr/bin/env bash
set -euo pipefail

if [ -z "${PR_NUMBER:-}" ]; then
	echo "::error::pr-number is required (could not be derived from the triggering event)."
	exit 1
fi

echo "::group::Fetch PR #$PR_NUMBER metadata"
gh pr view "$PR_NUMBER" \
	--json number,title,body,author,baseRefName,headRefName,changedFiles,additions,deletions,url \
	> /tmp/pr.json
jq -r '"\(.title) (#\(.number)) by \(.author.login): +\(.additions)/-\(.deletions) across \(.changedFiles) files"' /tmp/pr.json
echo "::endgroup::"

echo "::group::Fetch PR #$PR_NUMBER diff"
gh pr diff "$PR_NUMBER" > /tmp/pr.diff
wc -l /tmp/pr.diff
echo "::endgroup::"

# Compose the prompt: review template + optional caller-supplied instructions.
prompt=$(cat "$PROMPT_PATH")
if [ -n "${ADDITIONAL:-}" ]; then
	prompt+=$'\n\n## Additional Instructions\n\n'
	prompt+="$ADDITIONAL"
fi

echo "::group::Run pi"
review_file=$(mktemp)
pi \
	--no-session \
	--no-extensions \
	--no-skills \
	--no-prompt-templates \
	--offline \
	--provider "$PROVIDER" \
	--model "$MODEL" \
	--thinking "$THINKING" \
	--tools "$TOOLS" \
	-p "$prompt" \
	| tee "$review_file"
echo "::endgroup::"

# Emit the review markdown as a step output so downstream steps can use it.
delim="ghadelimiter_$(openssl rand -hex 16)"
{
	printf 'review<<%s\n' "$delim"
	cat "$review_file"
	printf '\n%s\n' "$delim"
} >> "$GITHUB_OUTPUT"
