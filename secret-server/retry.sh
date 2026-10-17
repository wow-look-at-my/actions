#!/usr/bin/env bash
# retry_get URL BEARER JUDGE: GETs URL with BEARER until JUDGE accepts or refuses the answer.

readonly RETRY_DELAY_SECONDS=5

retry_get() {
	local url="$1" bearer="$2" judge="$3" attempt=0 response verdict
	while true; do
		attempt=$((attempt + 1))
		response=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${bearer}" "${url}")
		status=$(echo "${response}" | tail -1)
		body=$(echo "${response}" | grep -v '^[0-9][0-9][0-9]$' || true)
		"${judge}"
		verdict=$?
		case "${verdict}" in
		0) return 0 ;;
		2) return 1 ;;
		esac
		echo "::warning::attempt ${attempt}: ${url%%\?*} returned HTTP ${status}: ${body}" >&2
		sleep "${RETRY_DELAY_SECONDS}"
	done
}
