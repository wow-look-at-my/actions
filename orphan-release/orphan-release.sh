#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-release.sh --path <action> [--exclude <patterns>] [--move <pairs>]
# Releases an action as orphan tags

path=""
exclude=""
move=""

while [[ $# -gt 0 ]]; do
	case $1 in
		--path) path="$2"; shift 2 ;;
		--exclude) exclude="$2"; shift 2 ;;
		--move) move="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$path" ]; then
	echo "Error: --path is required" >&2
	exit 1
fi

# Get script directory (where orphan-tag.sh and orphan-tag-name.sh live)
script_dir="$(cd "$(dirname "$0")/.." && pwd)"

echo "::group::[$path] Release"

# Generate tags
tags=$("$script_dir/orphan-tag-name/orphan-tag-name.sh" --path "$path")
echo "Tags: $tags"

# Create orphan commit and push
"$script_dir/orphan-tag/orphan-tag.sh" \
	--source "$path" \
	--tags "$tags" \
	--exclude "$exclude" \
	--move "$move"

echo "::endgroup::"
