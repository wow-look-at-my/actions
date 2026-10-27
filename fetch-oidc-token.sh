# !/usr/bin/env bash Prints the OIDC token GitHub issues for $AUDIENCE, read from the runner's token endpoint.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/retry.sh"

if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
	echo "::error::OIDC token not available. Add 'permissions: { id-token: write }' to your workflow." >&2
	exit 1
fi

# Every answer but a token is asked again.
judge_token() {
	[ "${status}" = "200" ] || return 1
	local token
	token=$(echo "${body}" | jq -r '.value // empty' 2>/dev/null)
	[ -n "${token}" ] || return 1
	printf '%s\n' "${token}"
}

retry_get "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}" "${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" judge_token
