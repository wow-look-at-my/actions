# !/usr/bin/env bash Prints the OIDC token GitHub issues for $AUDIENCE, read
# from the runner's token endpoint.
#
# The endpoint does not always answer with JSON. It rate-limits a run whose
# jobs all start together, and it serves an error page of its own during an
# incident. A pipe straight into jq turns either answer into "jq: parse error"
# and exit 5, which names neither the status nor the body. So read the status
# first, and print what arrived when the status is not 2xx.
#
# A non-2xx status is also worth another request: the endpoint is reachable
# and answering, and the next answer is usually the token. Retry on a fixed
# interval, and let the step's own timeout bound the wait.
set -uo pipefail

readonly RETRY_DELAY_SECONDS=5

if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
	echo "::error::OIDC token not available. Add 'permissions: { id-token: write }' to your workflow." >&2
	exit 1
fi

attempt=0
while true; do
	attempt=$((attempt + 1))

	response=$(curl -sS -w '\n%{http_code}' \
		-H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
		"${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}")
	status=$(echo "${response}" | tail -1)
	body=$(echo "${response}" | grep -v '^[0-9][0-9][0-9]$' || true)

	if [ "${status}" = "200" ]; then
		token=$(echo "${body}" | jq -r '.value // empty' 2>/dev/null)
		if [ -n "${token}" ]; then
			printf '%s\n' "${token}"
			exit 0
		fi
		# A 200 carrying no token is the endpoint answering with something
		# this script does not understand. Say what it was.
		echo "::warning::attempt ${attempt}: the OIDC endpoint returned 200 with no .value: ${body}" >&2
	else
		echo "::warning::attempt ${attempt}: the OIDC endpoint returned HTTP ${status}: ${body}" >&2
	fi

	sleep "${RETRY_DELAY_SECONDS}"
done
