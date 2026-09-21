#!/usr/bin/env bash
# Turns the action's inputs into a cache key, a normalized path list and the two
# temp-file paths the run step uses. Kept out of action.yml so `dats/plan.dats`
# can run it directly.
set -euo pipefail

: "${RUN_SCRIPT?the run input is not set}"
: "${RAW_PATHS?the paths input is not set}"
: "${RUNNER_OS_NAME?runner.os is not set}"
: "${RUNNER_ARCH_NAME?runner.arch is not set}"
: "${RUNNER_TEMP?RUNNER_TEMP is not set}"
: "${GITHUB_OUTPUT?GITHUB_OUTPUT is not set}"
EXTRA_KEY="${EXTRA_KEY:-}"

# A composite runner does not enforce `required: true`, so an omitted input
# arrives as an empty string and would otherwise cache whatever happened to be
# on disk under a key nothing produced.
if [ -z "${RUN_SCRIPT//[[:space:]]/}" ]; then
	echo '::error::cached-run: the run input is empty. Give it a script, or drop the action and call actions/cache directly.' >&2
	exit 1
fi

# Leading space breaks the glob actions/cache reads, so trim both ends. Sorting
# makes the key indifferent to the order the caller listed the paths in.
paths="$(printf '%s\n' "$RAW_PATHS" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort -u || true)"
if [ -z "$paths" ]; then
	echo '::error::cached-run: the paths input is empty. Name at least one output path to cache.' >&2
	exit 1
fi

# The script text and the path list both change what a hit MEANS, so both are in
# the digest. The field labels keep two different inputs from concatenating into
# one identical byte stream.
digest="$(
	{
		printf 'cached-run/v1\n'
		printf 'os\n%s\n%s\n' "$RUNNER_OS_NAME" "$RUNNER_ARCH_NAME"
		printf 'extra\n%s\n' "$EXTRA_KEY"
		printf 'paths\n%s\n' "$paths"
		printf 'run\n%s\n' "$RUN_SCRIPT"
	} | sha256sum | cut -c1-40
)"

# A cache key holds no comma. The label is cosmetic: it makes the entry readable
# in the cache list, and the digest is what actually distinguishes entries.
label="$(printf '%s' "$EXTRA_KEY" | tr -c 'A-Za-z0-9._-' '-' | tr -s '-' | sed 's/^-//; s/-$//' | cut -c1-48 | sed 's/-$//')"
key="cached-run-v1-${RUNNER_OS_NAME}-${RUNNER_ARCH_NAME}"
if [ -n "$label" ]; then
	key="${key}-${label}"
fi
key="${key}-${digest}"

{
	echo "key=${key}"
	echo "digest=${digest}"
	echo "sentinel=${RUNNER_TEMP}/cached-run-${digest}.done"
	echo 'paths<<CACHED_RUN_PATHS'
	printf '%s\n' "$paths"
	echo 'CACHED_RUN_PATHS'
} >> "$GITHUB_OUTPUT"

echo "cached-run key: ${key}"
printf 'cached-run paths:\n%s\n' "$paths"
