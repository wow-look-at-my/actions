#!/usr/bin/env bash
set -euo pipefail

# Usage: orphan-release.sh --source <dir> [--name <name>] [--version <version>] [--exclude <patterns>] [--message <msg>] [--include-branch]
# Name defaults to source directory. Version auto-increments if not specified.

source=""
name=""
version=""
exclude=""
message=""
include_branch=false

while [[ $# -gt 0 ]]; do
	case $1 in
		--source) source="$2"; shift 2 ;;
		--name) name="$2"; shift 2 ;;
		--version) version="$2"; shift 2 ;;
		--exclude) exclude="$2"; shift 2 ;;
		--message) message="$2"; shift 2 ;;
		--include-branch) include_branch=true; shift ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

if [ -z "$source" ]; then
	echo "Error: --source is required" >&2
	exit 1
fi

# Default name to source directory
[ -z "$name" ] && name="$source"

branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"

# Determine if we should use branch in tag names
use_branch=false
if [ "$include_branch" = true ] && [ "$branch" != "master" ] && [ "$branch" != "main" ]; then
	# Dependabot branches never publish tags: five open dependabot PRs once
	# minted 133 branch tags. Their pushes still build and test; the release
	# is a clean no-op.
	case "$branch" in
		dependabot/*)
			echo "[$name] Dependabot branch '$branch': skipping release (no tags)"
			exit 0
			;;
	esac
	use_branch=true
fi

# Build prefix for tag lookup
if [ "$use_branch" = true ]; then
	prefix="$name/$branch"
else
	prefix="$name"
fi

# Auto-increment version if not specified
auto_version=false
latest_tree=""
base_latest_tree=""
if [ -z "$version" ]; then
	auto_version=true
	git fetch --tags --quiet 2>/dev/null || true
	all_tags=$(git tag -l "$prefix#*" || true)
	max_version=$(echo "$all_tags" | grep -E "^${prefix}#[0-9]+$" | sed "s|^${prefix}#||" | sort -n | tail -1 || true)
	version=$((${max_version:-0} + 1))
	echo "Auto-incrementing to version $version"
	# Remember what #latest currently contains so an unchanged re-release can
	# be skipped instead of burning a new number on identical content.
	latest_tree=$(git rev-parse --verify --quiet "refs/tags/$prefix#latest^{tree}" || true)
	# On a branch, also remember the master-level #latest: branch tags exist
	# to test CHANGED actions, so content identical to what master already
	# serves publishes nothing. A brand-new action with no master #latest
	# yet always publishes.
	if [ "$use_branch" = true ]; then
		base_latest_tree=$(git rev-parse --verify --quiet "refs/tags/$name#latest^{tree}" || true)
	fi
elif ! [[ "$version" =~ ^[0-9]+$ ]]; then
	# Guard against garbage from upstream lookups (e.g. yq printing "null"
	# for a missing field), which used to mint tags like "name#null".
	echo "Error: --version must be a positive integer, got '$version'" >&2
	exit 1
fi

tags=("$prefix#$version" "$prefix#latest")
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

# In auto-increment mode, skip the release entirely when the content is
# byte-identical to what #latest already serves: tree OIDs are content-derived,
# so comparing them across repos is exact. Without this, every repo push would
# mint a new number for every action even when nothing about it changed.
# On a branch, the same comparison also runs against the master-level #latest
# first: an action that doesn't differ from what master serves has nothing to
# test, so it gets no branch tags at all.
if [ "$auto_version" = true ]; then
	staged_tree=$(git rev-parse 'HEAD^{tree}')
	if [ -n "$base_latest_tree" ] && [ "$staged_tree" = "$base_latest_tree" ]; then
		echo "[$prefix] Content identical to $name#latest (master); skipping branch release (no new tag)"
		exit 0
	fi
	if [ -n "$latest_tree" ] && [ "$staged_tree" = "$latest_tree" ]; then
		echo "[$prefix] Content identical to $prefix#latest; skipping release (no new tag)"
		exit 0
	fi
fi

echo "::group::[$first_tag] Push tags"
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
	git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/$GITHUB_REPOSITORY"
fi

for tag in "${tags[@]}"; do
	git tag "$tag"
	echo "Created tag: $tag"
done

if [ "$auto_version" = true ]; then
	# Numbered releases are immutable: push the new number WITHOUT force so a
	# stale/failed tag listing can only fail loudly, never rewrite history.
	# Only #latest (a mutable pointer by contract) is force-moved.
	git push origin "refs/tags/$prefix#$version" "+refs/tags/$prefix#latest:refs/tags/$prefix#latest"
else
	# Explicit --version keeps the historical re-pin semantics.
	git push --force origin "refs/tags/$prefix#$version" "refs/tags/$prefix#latest"
fi
echo "::endgroup::"
