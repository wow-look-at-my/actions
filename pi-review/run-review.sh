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

prompt=$(cat "$PROMPT_PATH")
if [ -n "${ADDITIONAL:-}" ]; then
	prompt+=$'\n\n## Additional Instructions\n\n'
	prompt+="$ADDITIONAL"
fi

events_file=$(mktemp)
stderr_file=$(mktemp)

echo "::group::Run pi (--mode json, this is silent until pi exits)"
echo "Provider: $PROVIDER  Model: $MODEL  Thinking: $THINKING  Tools: $TOOLS"
set +e
pi \
	--no-session \
	--no-extensions \
	--no-skills \
	--no-prompt-templates \
	--offline \
	--mode json \
	--provider "$PROVIDER" \
	--model "$MODEL" \
	--thinking "$THINKING" \
	--tools "$TOOLS" \
	"$prompt" \
	> "$events_file" \
	2> "$stderr_file"
pi_exit=$?
set -e
echo "pi exited with status $pi_exit"
echo "stdout (event stream): $(wc -c < "$events_file") bytes / $(wc -l < "$events_file") lines"
echo "stderr:                $(wc -c < "$stderr_file") bytes"
echo "::endgroup::"

if [ -s "$stderr_file" ]; then
	echo "::group::pi stderr"
	cat "$stderr_file"
	echo "::endgroup::"
fi

if [ -s "$events_file" ]; then
	echo "::group::pi event type histogram"
	jq -r '.type' "$events_file" 2>/dev/null | sort | uniq -c || echo "could not parse events as JSONL"
	echo "::endgroup::"
fi

if [ "$pi_exit" -ne 0 ]; then
	echo "::error::pi exited non-zero ($pi_exit). See stderr and event stream above."
	exit "$pi_exit"
fi

if [ ! -s "$events_file" ]; then
	echo "::error::pi exited 0 but produced no events. Something is wrong with stdout capture or pi's mode handling."
	exit 1
fi

# Extract the final assistant message's text content from the JSONL event stream.
review=$(jq -rs '
	(map(select(.type == "message_end" and .message.role == "assistant")) | last) as $final
	| if ($final | type) == "null" then ""
	  else
		(($final.message.content // [])
			| map(select(.type == "text") | .text)
			| join(""))
	  end
' "$events_file")

if [ -z "$review" ]; then
	echo "::error::pi event stream contained no assistant text content. Dumping full stream:"
	cat "$events_file"
	exit 1
fi

echo "::group::Review"
printf '%s\n' "$review"
echo "::endgroup::"

delim="ghadelimiter_$(openssl rand -hex 16)"
{
	printf 'review<<%s\n' "$delim"
	printf '%s\n' "$review"
	printf '%s\n' "$delim"
} >> "$GITHUB_OUTPUT"
