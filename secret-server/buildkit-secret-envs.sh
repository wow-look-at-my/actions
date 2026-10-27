#!/usr/bin/env bash
# Prints one NAME=NAME line per key in the JSON object $SECRETS, the form docker/build-push-action's secret-envs input takes.
set -euo pipefail

echo "${SECRETS}" | jq -r 'keys[]' | tr -d '\r' | while IFS= read -r key; do
	echo "${key}=${key}"
done
