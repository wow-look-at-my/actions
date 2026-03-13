#!/usr/bin/env bash
set -euo pipefail

# Usage: branch-block.sh --branch <branch> [--ruleset <name>]
# Adds a branch pattern to a ruleset that blocks branch creation

branch=""
ruleset_name="merged-branches"

while [[ $# -gt 0 ]]; do
	case $1 in
		--branch) branch="$2"; shift 2 ;;
		--ruleset) ruleset_name="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$branch" ]; then
	echo "Error: --branch is required" >&2
	exit 1
fi

echo "::group::Block branch creation: $branch"

# Find existing ruleset ID by name
ruleset_id=$(gh api "repos/{owner}/{repo}/rulesets" --jq ".[] | select(.name == \"$ruleset_name\") | .id" 2>/dev/null || true)

if [ -z "$ruleset_id" ]; then
	echo "Creating ruleset: $ruleset_name"
	gh api "repos/{owner}/{repo}/rulesets" \
		--method POST \
		--input - <<EOF
{
	"name": "$ruleset_name",
	"target": "branch",
	"enforcement": "active",
	"conditions": {
		"ref_name": {
			"include": ["refs/heads/$branch"],
			"exclude": []
		}
	},
	"rules": [
		{"type": "creation"}
	]
}
EOF
else
	echo "Updating ruleset: $ruleset_name (ID: $ruleset_id)"

	# Fetch the full ruleset to get current conditions
	ruleset=$(gh api "repos/{owner}/{repo}/rulesets/$ruleset_id")
	current_includes=$(echo "$ruleset" | jq '.conditions.ref_name.include // []')
	new_pattern="refs/heads/$branch"

	# Check if pattern already exists
	if echo "$current_includes" | jq -e ". | index(\"$new_pattern\")" > /dev/null 2>&1; then
		echo "Branch pattern already blocked: $branch"
	else
		# Add new pattern
		updated_includes=$(echo "$current_includes" | jq ". + [\"$new_pattern\"]")

		gh api "repos/{owner}/{repo}/rulesets/$ruleset_id" \
			--method PUT \
			--input - <<EOF
{
	"name": "$ruleset_name",
	"target": "branch",
	"enforcement": "active",
	"conditions": {
		"ref_name": {
			"include": $updated_includes,
			"exclude": []
		}
	},
	"rules": [
		{"type": "creation"}
	]
}
EOF
		echo "Added branch pattern: $branch"
	fi
fi

echo "::endgroup::"
