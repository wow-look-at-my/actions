#!/usr/bin/env bash
set -euo pipefail

# Proves the numbered tag survives a lost race on #latest.
#
# A concurrent run moves #latest between this run's handshake and its push, and
# GitHub rejects the ref it cannot lock. When both refs travelled in one push,
# that rejection took the numbered tag with it and the release ended with no tag
# at all. The two refs now go in separate pushes.
#
# A real race is not reproducible on demand, so the remote refuses the pointer
# instead: a pre-receive hook that rejects #latest stands in for losing the
# race, and the question is only what happens to the OTHER ref in the same
# push. Run this against the one-push version and the first case fails.

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass=0
fail=0

check() {
	local what="$1" want="$2" got="$3"
	if [ "$want" = "$got" ]; then
		echo "ok: $what"
		pass=$((pass + 1))
	else
		echo "FAIL: $what -- wanted $want, got $got" >&2
		fail=$((fail + 1))
	fi
}

# origin: a bare repo whose pre-receive hook rejects one named ref, so a push
# carrying it fails exactly the way a lost lock does.
make_origin() {
	local dir="$1" reject="${2:-}"
	git init --quiet --bare "$dir"
	if [ -n "$reject" ]; then
		cat > "$dir/hooks/pre-receive" <<HOOK
#!/usr/bin/env bash
while read -r _old _new ref; do
	if [ "\$ref" = "$reject" ]; then
		echo "rejecting \$ref (standing in for a lost lock)" >&2
		exit 1
	fi
done
exit 0
HOOK
		chmod +x "$dir/hooks/pre-receive"
	fi
}

# The script builds its push URL out of GITHUB_REPOSITORY, so the test sends
# that URL to a local bare repository through git's own insteadOf, in the
# environment rather than in anyone's config file. Nothing in the script
# changes for the test's benefit.
REMOTE_URL="https://x-access-token:@github.com/owner/repo"

# release runs the script the way the action does: a source tree on master,
# pushing to the given origin. Pass a version to pin one, or nothing for the
# auto-increment path the release workflow actually uses.
release() {
	local origin="$1" repo="$2" version="${3:-}"
	rm -rf "$repo"
	mkdir -p "$repo/payload"
	echo "content ${version:-auto} $RANDOM" > "$repo/payload/file.txt"
	git init --quiet "$repo"
	git -C "$repo" config user.email t@example.com
	git -C "$repo" config user.name test
	git -C "$repo" checkout --quiet -b master
	git -C "$repo" add -A
	git -C "$repo" commit --quiet -m "source"
	git -C "$repo" remote add origin "$origin"

	local args=(--source payload --name widget --message "release ${version:-auto}")
	[ -n "$version" ] && args+=(--version "$version")

	(
		cd "$repo"
		export GITHUB_REF_NAME=master GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=
		export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.$origin.insteadOf" GIT_CONFIG_VALUE_0="$REMOTE_URL"
		"$here/orphan-release.sh" "${args[@]}"
	)
}

# 1. The pointer is refused; the numbered tag must land anyway.
make_origin "$work/origin1.git" "refs/tags/widget#latest"
release "$work/origin1.git" "$work/repo1" 7 > "$work/log1" 2>&1 && rc=0 || rc=$?
check "a refused #latest fails the release loudly" 1 "$((rc == 0 ? 0 : 1))"
numbered=$(git ls-remote --tags "$work/origin1.git" 2>/dev/null | grep -c 'refs/tags/widget#7$' || true)
check "the numbered tag lands even when #latest is refused" 1 "$numbered"

# 2. Nothing refused: both refs land.
make_origin "$work/origin2.git"
release "$work/origin2.git" "$work/repo2" 8 > "$work/log2" 2>&1
refs=$(git ls-remote --tags "$work/origin2.git" 2>/dev/null | grep -cE 'refs/tags/widget#(8|latest)$' || true)
check "an uncontested release publishes both refs" 2 "$refs"

# 3. The same, on the auto-increment path the release workflow uses.
make_origin "$work/origin3.git" "refs/tags/widget#latest"
release "$work/origin3.git" "$work/repo4" > "$work/log4" 2>&1 && rc=0 || rc=$?
check "auto-increment also fails loudly on a refused #latest" 1 "$((rc == 0 ? 0 : 1))"
auto=$(git ls-remote --tags "$work/origin3.git" 2>/dev/null | grep -c 'refs/tags/widget#1$' || true)
check "auto-increment lands its numbered tag when #latest is refused" 1 "$auto"

# 4. #latest really moves on a re-release, and the old number stays put.
release "$work/origin2.git" "$work/repo3" 9 > "$work/log3" 2>&1
latest=$(git ls-remote --tags "$work/origin2.git" 'refs/tags/widget#latest' | cut -f1)
nine=$(git ls-remote --tags "$work/origin2.git" 'refs/tags/widget#9' | cut -f1)
eight=$(git ls-remote --tags "$work/origin2.git" 'refs/tags/widget#8' | cut -f1)
check "#latest follows the newest release" "$nine" "$latest"
check "an older numbered tag is untouched" 1 "$([ -n "$eight" ] && echo 1 || echo 0)"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
