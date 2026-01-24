#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-cleanup.sh
# Deletes all tags for branches that no longer exist

echo "::group::Cleanup orphaned branch tags"

git fetch --tags --quiet 2>/dev/null || true
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' --quiet 2>/dev/null || true

# Find all branch tags and check if branch still exists
for tag in $(git tag -l "*/*#*"); do
	# Extract branch from tag (everything between first / and last #)
	# e.g., "action/feature-branch#1" -> "feature-branch"
	tag_branch=$(echo "$tag" | sed -E 's|^[^/]+/([^#]+)#.*|\1|')

	# Check if branch exists
	if ! git ls-remote --heads origin "$tag_branch" | grep -q .; then
		echo "Deleting orphaned tag: $tag (branch '$tag_branch' no longer exists)"
		git push origin --delete "$tag" || true
	fi
done

echo "::endgroup::"
