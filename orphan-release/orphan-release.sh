#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-release.sh --source <dir> [--tags <tags>] [--version <version>] [--exclude <patterns>] [--message <msg>]
# If no --tags or --version, auto-increments based on existing tags.

source=""
tags=()
version=""
exclude=""
message=""

while [[ $# -gt 0 ]]; do
	case $1 in
		--source) source="$2"; shift 2 ;;
		--tags) for t in $2; do tags+=("$t"); done; shift 2 ;;
		--version) version="$2"; shift 2 ;;
		--exclude) exclude="$2"; shift 2 ;;
		--message) message="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$source" ]; then
	echo "Error: --source is required" >&2
	exit 1
fi

branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"

# Generate tags if not explicitly provided
if [ ${#tags[@]} -eq 0 ]; then
	# Auto-increment version if not specified
	if [ -z "$version" ]; then
		if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
			prefix="$source"
		else
			prefix="$source/$branch"
		fi

		# Fetch tags and find highest version
		git fetch --tags --quiet 2>/dev/null || true
		max_version=$(git tag -l "$prefix#*" | grep -E "^${prefix}#[0-9]+$" | sed "s|^${prefix}#||" | sort -n | tail -1)
		version=$((${max_version:-0} + 1))
		echo "Auto-incrementing to version $version"
	fi

	if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
		tags=("$source#$version" "$source#latest")
	else
		tags=("$source/$branch#$version" "$source/$branch#latest")
	fi
fi

first_tag="${tags[0]}"
[ -z "$message" ] && message="Release $first_tag"

echo "::group::[$first_tag] Prepare content"
tmpdir=$(mktemp -d)
cp -r "$source"/. "$tmpdir/"

for pattern in $exclude; do
	rm -rf "$tmpdir"/$pattern 2>/dev/null || true
done
echo "::endgroup::"

echo "::group::[$first_tag] Create orphan commit"
cd "$tmpdir"
git init -b master
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A
git commit -m "$message"
echo "::endgroup::"

echo "::group::[$first_tag] Push tags"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
	git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/$GITHUB_REPOSITORY"
fi

refs=""
for tag in "${tags[@]}"; do
	git tag "$tag"
	refs="$refs refs/tags/$tag"
	echo "Created tag: $tag"
done

git push --force origin $refs
echo "::endgroup::"
