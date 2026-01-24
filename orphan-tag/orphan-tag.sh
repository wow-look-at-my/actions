#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-tag.sh --source <dir> [--tags <tags> | --version <version>] [--exclude <patterns>] [--move <pairs>] [--message <msg>]
# Either --tags or --version is required. If --version is given, tags are auto-generated.

source=""
tags=()
version=""
exclude=""
move=""
message=""

while [[ $# -gt 0 ]]; do
	case $1 in
		--source) source="$2"; shift 2 ;;
		--tags) for t in $2; do tags+=("$t"); done; shift 2 ;;
		--version) version="$2"; shift 2 ;;
		--exclude) exclude="$2"; shift 2 ;;
		--move) move="$2"; shift 2 ;;
		--message) message="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$source" ]; then
	echo "Error: --source is required" >&2
	exit 1
fi

# Generate tags from version if not explicitly provided
if [ ${#tags[@]} -eq 0 ]; then
	if [ -z "$version" ]; then
		echo "Error: --tags or --version is required" >&2
		exit 1
	fi

	branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
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

for pair in $move; do
	src="${pair%%:*}"
	dst="${pair#*:}"
	[ -f "$source/$src" ] && mkdir -p "$(dirname "$tmpdir/$dst")" && cp "$source/$src" "$tmpdir/$dst"
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
