#!/usr/bin/env bash
# Assembles and runs the caller's script: `set -euo pipefail` on the front, a
# sentinel `touch` on the back. The sentinel is the save gate, so a script that
# ends early leaves it absent and nothing is cached.
set -euo pipefail

: "${RUN_SCRIPT?the run input is not set}"
: "${SENTINEL?the sentinel path is not set}"
: "${SCRIPT_FILE?the script path is not set}"

rm -f "$SENTINEL"
{
	echo 'set -euo pipefail'
	printf '%s\n' "$RUN_SCRIPT"
	printf 'touch %q\n' "$SENTINEL"
} > "$SCRIPT_FILE"

bash "$SCRIPT_FILE"
