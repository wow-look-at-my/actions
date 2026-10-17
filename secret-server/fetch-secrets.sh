#!/usr/bin/env bash
# Prints the secrets JSON the server at $SECRET_SERVER_URL gives $OIDC_TOKEN.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/retry.sh"

# Cloudflare answers for an origin it cannot reach with "error code: NNNN", under
# a status of its own choice. That is an outage, not the server's verdict, so it
# is asked again with the other transient answers. Any other refusal fails.
judge_secrets() {
	case "${status}:${body}" in
	2??:*)
		printf '%s\n' "${body}"
		return 0
		;;
	*:"error code: "* | 000:* | 408:* | 429:* | 5??:*)
		return 1
		;;
	esac
	echo "::error::Secret server returned HTTP ${status}: ${body}" >&2
	return 2
}

retry_get "${SECRET_SERVER_URL}/github/v1/secrets" "${OIDC_TOKEN}" judge_secrets
