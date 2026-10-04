#!/usr/bin/env bash
# Exports each key in the JSON object $SECRETS as a masked environment variable, via the GITHUB_ENV delimiter format.
set -uo pipefail

echo "${SECRETS}" | jq -r 'to_entries[] | .key' | tr -d '\r' | while IFS= read -r key; do
	val=$(echo "${SECRETS}" | jq -r --arg k "$key" '.[$k]' | tr -d '\r')
	echo "::add-mask::${val}"
	delimiter="ghadelimiter_$(openssl rand -hex 8)"
	printf '%s<<%s\n%s\n%s\n' "$key" "$delimiter" "$val" "$delimiter" >> "$GITHUB_ENV"
done
