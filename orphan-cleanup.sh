#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-cleanup.sh
# Deletes all tags for branches that no longer exist

echo "::group::Cleanup orphaned branch tags"

git fetch --tags --quiet 2>/dev/null || true
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' --quiet 2>/dev/null || true

# Get current branch to exclude from cleanup
current_branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Current branch: $current_branch (excluded from cleanup)"

# Get list of remote branches
remote_branches=$(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||')

# Find all branch tags and check if branch still exists
for tag in $(git tag -l "*/*#*"); do
	# Extract branch from tag (everything between first / and last #)
	# e.g., "action/feature-branch#1" -> "feature-branch"
	tag_branch=$(echo "$tag" | sed -E 's|^[^/]+/([^#]+)#.*|\1|')

	# Skip current branch
	if [ "$tag_branch" = "$current_branch" ]; then
		continue
	fi

	# Check if branch exists in remote branches list
	if ! echo "$remote_branches" | grep -qx "$tag_branch"; then
		echo "Deleting orphaned tag: $tag (branch '$tag_branch' no longer exists)"
		git push origin --delete "$tag" 2>/dev/null || true
	fi
done

echo "::endgroup::"
