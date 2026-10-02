# jq.exe on Windows writes CRLF, so a key or value read off its stdout can
# carry a trailing \r. Left in, GO_BUILDCACHE_CONFIG becomes the literal
# variable name GO_BUILDCACHE_CONFIG\r, and go-toolchain's own
# os.Getenv("GO_BUILDCACHE_CONFIG") then finds nothing set.
#
# A real jq.exe is not available here, so a wrapper stands in for it: real
# jq's output, with \r appended to every line, the same shape Windows
# produces. export-secrets.sh must still emit clean keys and values through
# it.
sandbox:
	network: false

shared:
	files:
		fakejq: |
			#!/usr/bin/env bash
			exec "$REAL_JQ" "$@" | sed 's/$/\r/'

tests:
	- desc: a key survives a CRLF-emitting jq (Windows jq.exe) intact
	  exit: 0
	  inputs:
		files:
			run.sh: |
				set -uo pipefail
				work="$(mktemp -d)"
				REAL_JQ="$(command -v jq)"
				export REAL_JQ
				mkdir -p "$work/fakebin"
				cp {shared.fakejq} "$work/fakebin/jq"
				chmod +x "$work/fakebin/jq"
				export PATH="$work/fakebin:$PATH"

				export SECRETS='{"GO_BUILDCACHE_CONFIG":"abc123","OTHER_KEY":"xyz"}'
				export GITHUB_ENV="$work/github_env"
				: > "$GITHUB_ENV"
				bash "$SCRIPT"

				grep -q '^GO_BUILDCACHE_CONFIG<<' "$GITHUB_ENV" && echo "KEY_CLEAN=yes" || echo "KEY_CLEAN=no"
				grep -q '^OTHER_KEY<<' "$GITHUB_ENV" && echo "OTHER_KEY_CLEAN=yes" || echo "OTHER_KEY_CLEAN=no"
				grep -Pq '\r' "$GITHUB_ENV" && echo "HAS_CR=yes" || echo "HAS_CR=no"
	  cmd: env SCRIPT="$PWD/secret-server/export-secrets.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "KEY_CLEAN=yes"
			- "OTHER_KEY_CLEAN=yes"
			- "HAS_CR=no"

	# The OIDC endpoint rate-limits a run whose jobs start together, and it
	# serves an error page of its own during an incident. Neither answer is
	# JSON. A pipe into jq ends the step with "jq: parse error" and exit 5,
	# which names neither the status nor the body. So the token fetch reads
	# the status itself, reports what arrived, and asks again.
	- desc: a non-JSON answer is retried, and the next answer gives the token
	  exit: 0
	  inputs:
		files:
			fakecurl: |
				#!/usr/bin/env bash
				seen=$(cat "$FAKE_CURL_COUNT" 2>/dev/null || echo 0)
				echo $((seen + 1)) > "$FAKE_CURL_COUNT"
				if [ "$seen" -eq 0 ]; then
					printf '<html>Too Many Requests</html>\n429\n'
				else
					printf '{"value":"the-token"}\n200\n'
				fi
			run.sh: |
				set -uo pipefail
				work="$(mktemp -d)"
				mkdir -p "$work/fakebin"
				cp {inputs.fakecurl} "$work/fakebin/curl"
				chmod +x "$work/fakebin/curl"
				export PATH="$work/fakebin:$PATH"
				export FAKE_CURL_COUNT="$work/count"

				export ACTIONS_ID_TOKEN_REQUEST_URL='https://example.invalid/token?x=1'
				export ACTIONS_ID_TOKEN_REQUEST_TOKEN='request-token'
				export AUDIENCE='https://secrets.example.invalid'

				echo "TOKEN=$(bash "$SCRIPT" 2>"$work/err")"
				grep -q 'HTTP 429' "$work/err" && echo "REPORTED_STATUS=yes" || echo "REPORTED_STATUS=no"
				grep -q 'Too Many Requests' "$work/err" && echo "REPORTED_BODY=yes" || echo "REPORTED_BODY=no"
	  cmd: env SCRIPT="$PWD/secret-server/fetch-oidc-token.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "TOKEN=the-token"
			- "REPORTED_STATUS=yes"
			- "REPORTED_BODY=yes"

	# A missing id-token permission is the caller's own mistake. No retry
	# reaches it, so it fails at once and names the permission.
	- desc: a missing id-token permission fails at once
	  exit: 1
	  inputs:
		files:
			run.sh: |
				set -uo pipefail
				unset ACTIONS_ID_TOKEN_REQUEST_URL ACTIONS_ID_TOKEN_REQUEST_TOKEN
				export AUDIENCE='https://secrets.example.invalid'
				bash "$SCRIPT"
	  cmd: env SCRIPT="$PWD/secret-server/fetch-oidc-token.sh" bash {inputs.run.sh}
	  outputs:
		stderr:
			- "id-token: write"

	# The ordinary case, a real (non-CRLF) jq, must keep working the same way.
	- desc: a key survives an ordinary jq unchanged
	  exit: 0
	  inputs:
		files:
			run.sh: |
				set -uo pipefail
				work="$(mktemp -d)"
				export SECRETS='{"GO_BUILDCACHE_CONFIG":"abc123"}'
				export GITHUB_ENV="$work/github_env"
				: > "$GITHUB_ENV"
				bash "$SCRIPT"
				grep -q '^GO_BUILDCACHE_CONFIG<<' "$GITHUB_ENV" && echo "KEY_CLEAN=yes" || echo "KEY_CLEAN=no"
	  cmd: env SCRIPT="$PWD/secret-server/export-secrets.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "KEY_CLEAN=yes"
