#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-cleanup.sh --branch <branch>
# Deletes all tags for a deleted branch (name/branch#* pattern)

branch=""

while [[ $# -gt 0 ]]; do
	case $1 in
		--branch) branch="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$branch" ]; then
	echo "Error: --branch is required" >&2
	exit 1
fi

echo "::group::Cleaning up tags for branch: $branch"

git fetch --tags --quiet 2>/dev/null || true

# Find tags matching */branch#* pattern
tags=$(git tag -l "*/$branch#*" "*/$branch")

if [ -z "$tags" ]; then
	echo "No tags found for branch: $branch"
else
	for tag in $tags; do
		echo "Deleting tag: $tag"
		git push origin --delete "$tag" || true
	done
fi

echo "::endgroup::"
