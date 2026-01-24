#!/usr/bin/env bash
set -euo pipefail

# Usage: action-tag.sh --path <dir> [--branch <branch>]
# Outputs: tag string in format name@vN or name/branch@vN

path=""
branch=""

while [[ $# -gt 0 ]]; do
	case $1 in
		--path) path="$2"; shift 2 ;;
		--branch) branch="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$path" ]; then
	echo "Error: --path is required" >&2
	exit 1
fi

# Get branch from environment or git
if [ -z "$branch" ]; then
	branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
fi

# Get version - node projects use package.json, others use action.yml
if [ -f "$path/package.json" ]; then
	version=$(jq -r '.version | split(".")[0]' "$path/package.json")
else
	version=$(yq '.version' "$path/action.yml")
fi

# Build tag string
if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
	echo "$path@v$version"
else
	echo "$path/$branch@v$version"
fi
