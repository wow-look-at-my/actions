#!/bin/sh
# Build a superproject whose submodule gitlink moves as the named scenario says,
# and print the superproject's path. The caller runs the action there.
#
# The submodule's own repository carries one line of history, one -> two, and an
# orphan commit beside it. Which commit each side of the superproject names is
# what each scenario picks.
#
# The gitlink is written with update-index rather than by checking the submodule
# out at that commit. The action reads the tree, so the index is what decides,
# and a checkout of every scenario costs the fixture nothing it uses.
set -eu

scenario="$1"
root="$(mktemp -d)"
export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.com
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.com
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always

sub="$root/subwork"
git init -q -b master "$sub"
printf 'one\n' > "$sub/f"
git -C "$sub" add f
git -C "$sub" commit -qm one
one="$(git -C "$sub" rev-parse HEAD)"
printf 'two\n' > "$sub/f"
git -C "$sub" add f
git -C "$sub" commit -qm two
two="$(git -C "$sub" rev-parse HEAD)"

# An orphan commit, which is what a force-push over the submodule's branch
# leaves behind. Plumbing builds it, so the fixture never leaves master.
blob="$(printf 'other\n' | git -C "$sub" hash-object -w --stdin)"
tree="$(printf '100644 blob %s\tf\n' "$blob" | git -C "$sub" mktree)"
orphan="$(git -C "$sub" commit-tree "$tree" -m other)"
git -C "$sub" update-ref refs/heads/other "$orphan"

# A commit no server serves: the action cannot compare against what it cannot
# fetch, and that case must fail rather than pass quietly.
blob="$(printf 'unreachable\n' | git -C "$sub" hash-object -w --stdin)"
tree="$(printf '100644 blob %s\tf\n' "$blob" | git -C "$sub" mktree)"
missing="$(git -C "$sub" commit-tree "$tree" -m unreachable)"

git clone -q --bare "$sub" "$root/sub.git"
# The unreachable commit is written after the clone, so the origin lacks it
# while the checkout below still resolves the gitlink.
git -C "$sub" update-ref refs/heads/unreachable "$missing"

case "$scenario" in
	forward) base="$one"; head="$two" ;;
	backward) base="$two"; head="$one" ;;
	unmoved) base="$one"; head="$one" ;;
	unrelated) base="$two"; head="$orphan" ;;
	unreachable) base="$one"; head="$missing" ;;
	added) base=""; head="$two" ;;
	*) echo "unknown scenario $scenario" >&2; exit 2 ;;
esac

sup="$root/super"
git init -q -b master "$sup"
printf 'super\n' > "$sup/readme"
git -C "$sup" add readme
if [ -n "$base" ]; then
	git -C "$sup" submodule add -q "$root/sub.git" sub
	git -C "$sup" update-index --cacheinfo "160000,$base,sub"
fi
git -C "$sup" commit -qm base

git clone -q --bare "$sup" "$root/super.git"
git -C "$sup" remote add origin "$root/super.git"
git -C "$sup" fetch -q origin

if [ -z "$base" ]; then
	git -C "$sup" submodule add -q "$root/sub.git" sub
fi
git -C "$sup" update-index --cacheinfo "160000,$head,sub"
# The branch carries a change of its own, so the head commit exists even when
# the scenario leaves the gitlink where the base put it.
printf 'head\n' >> "$sup/readme"
git -C "$sup" add readme
git -C "$sup" commit -qm head

printf '%s\n' "$sup"
