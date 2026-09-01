#!/usr/bin/env bash
set -uo pipefail

# Resolve one permission scope for one job the way GitHub does: the job's own
# permissions block, and the workflow block when the job declares none.
# see README.md

fail() {
	echo "::error::$*"
	exit 1
}

rank() {
	case "$1" in
		write) echo 2 ;;
		read) echo 1 ;;
		*) echo 0 ;;
	esac
}

# A block that exists but omits the scope grants it nothing: GitHub drops every
# scope the block leaves out. An absent block prints nothing at all.
level_in() {
	local expr="$1" where="$2" kind value
	kind=$(yq -r "$expr | type" "$FILE") || fail "$FILE is not readable YAML"
	case "$kind" in
		'!!null')
			return ;;
		'!!str')
			value=$(yq -r "$expr" "$FILE")
			case "$value" in
				write-all) echo write ;;
				read-all) echo read ;;
				*) fail "$where permissions is '$value', which is neither read-all nor write-all" ;;
			esac ;;
		'!!map')
			if [ "$(yq -r "$expr | has(\"$PERMISSION\")" "$FILE")" != 'true' ]; then
				echo none
				return
			fi
			value=$(yq -r "$expr.\"$PERMISSION\"" "$FILE")
			case "$value" in
				read|write|none) echo "$value" ;;
				*) fail "$where permissions.$PERMISSION is '$value', not read, write or none" ;;
			esac ;;
		*)
			fail "$where permissions is $kind, not a mapping" ;;
	esac
}

PERMISSION="$(echo "${INPUT_PERMISSION:-}" | tr -d '[:space:]')"
[ -n "$PERMISSION" ] || fail "permission is required"

LEVEL="$(echo "${INPUT_LEVEL:-}" | tr -d '[:space:]')"
LEVEL="${LEVEL:-write}"
case "$LEVEL" in
	read|write|none) ;;
	*) fail "level is '$LEVEL', not read, write or none" ;;
esac

FILE="$(echo "${INPUT_WORKFLOW:-}" | tr -d '[:space:]')"
if [ -z "$FILE" ]; then
	[ -n "${GITHUB_WORKFLOW_REF:-}" ] || fail "GITHUB_WORKFLOW_REF is unset, so the running workflow cannot be identified"
	# owner/repo/.github/workflows/ci.yml@refs/heads/master
	FILE="${GITHUB_WORKFLOW_REF%@*}"
	FILE="${FILE#*/}"
	FILE="${FILE#*/}"
fi
FILE="${GITHUB_WORKSPACE:-$PWD}/$FILE"
[ -f "$FILE" ] || fail "$FILE does not exist. Check the repository out before this step."

JOB="$(echo "${INPUT_JOB:-}" | tr -d '[:space:]')"
JOB="${JOB:-${GITHUB_JOB:-}}"
[ -n "$JOB" ] || fail "GITHUB_JOB is unset, so the running job cannot be identified"

[ "$(yq -r '.jobs | type' "$FILE")" = '!!map' ] || fail "$FILE names no jobs"
if [ "$(yq -r ".jobs | has(\"$JOB\")" "$FILE")" != 'true' ]; then
	fail "$FILE names no job '$JOB'. It has: $(yq -r '.jobs | keys | join(", ")' "$FILE")"
fi

JOB_EXPR=".jobs.\"$JOB\""
FOUND="$(level_in "$JOB_EXPR.permissions" "job '$JOB'")" || exit 1
SOURCE=job
if [ -z "$FOUND" ]; then
	FOUND="$(level_in '.permissions' workflow)" || exit 1
	SOURCE=workflow
fi
if [ -z "$FOUND" ]; then
	FOUND=none
	SOURCE=default
fi

GRANTED=false
[ "$(rank "$FOUND")" -ge "$(rank "$LEVEL")" ] && GRANTED=true

WHERE="${FILE#${GITHUB_WORKSPACE:-$PWD}/} job '$JOB'"
{
	echo "granted=$GRANTED"
	echo "level=$FOUND"
	echo "source=$SOURCE"
} >> "${GITHUB_OUTPUT:-/dev/null}"

if [ "$GRANTED" = true ]; then
	echo "$PERMISSION: $FOUND is granted to $WHERE by its $SOURCE permissions block"
	exit 0
fi

if [ "$SOURCE" = default ]; then
	WHY="$WHERE declares no permissions block, so $PERMISSION falls to the repository default. Declare the block to grant it."
else
	WHY="$PERMISSION: $LEVEL is NOT granted to $WHERE. Its $SOURCE permissions block gives $FOUND."
fi

case "$(echo "${INPUT_ASSERT:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
	true) fail "$WHY" ;;
esac

if [ "$SOURCE" = default ]; then
	echo "::warning::$WHY"
else
	echo "$WHY"
fi
