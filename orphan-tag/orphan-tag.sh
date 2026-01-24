#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-tag.sh <source> <tags> [exclude] [move] [message]
#   source  - Source directory to package
#   tags    - Space-separated tag names to create
#   exclude - Space-separated patterns to exclude (optional)
#   move    - Space-separated src:dst pairs to move files (optional)
#   message - Commit message, defaults to "Release <first_tag>" (optional)

source="$1"
tags="$2"
exclude="${3:-}"
move="${4:-}"
message="${5:-}"

first_tag="${tags%% *}"
[ -z "$message" ] && message="Release $first_tag"

echo "::group::Prepare content"
tmpdir=$(mktemp -d)
cp -r "$source"/* "$tmpdir/"

for pattern in $exclude; do
	rm -rf "$tmpdir"/$pattern 2>/dev/null || true
done

for pair in $move; do
	src="${pair%%:*}"
	dst="${pair#*:}"
	[ -f "$source/$src" ] && mkdir -p "$(dirname "$tmpdir/$dst")" && cp "$source/$src" "$tmpdir/$dst"
done
echo "::endgroup::"

echo "::group::Create orphan commit"
cd "$tmpdir"
git init -b master
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A
git commit -m "$message"
echo "::endgroup::"

echo "::group::Push tags"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
	git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/$GITHUB_REPOSITORY"
fi

refs=""
for tag in $tags; do
	[ -z "$tag" ] && continue
	git tag "$tag"
	refs="$refs refs/tags/$tag"
	echo "Created tag: $tag"
done

git push --force origin $refs
echo "::endgroup::"
