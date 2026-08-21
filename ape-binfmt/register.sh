#!/usr/bin/env bash
# Teach this kernel to exec an Actually Portable Executable.
#
# An APE opens with the magic MZqFpD and is a polyglot: the same bytes are a PE
# header, an ELF header and a shell script. The kernel knows none of that, so a
# raw execve of one answers ENOEXEC -- which is what "exec format error" from
# docker, from Go's os/exec, or from a container entrypoint means.
#
# The interpreter is /bin/sh, not a separate loader: the file's own header IS
# the trampoline, and it locates and runs the right embedded binary. So there is
# nothing to download and nothing to keep up to date.
#
# see ape-binfmt/README.md
set -euo pipefail

MAGIC='MZqFpD'
NAME='APE'
NODE="/proc/sys/fs/binfmt_misc/${NAME}"

sudo=""
if [ "$(id -u)" -ne 0 ]; then
	command -v sudo >/dev/null || {
		echo "not root and no sudo: cannot register a binfmt handler" >&2
		exit 1
	}
	sudo="sudo"
fi

# The filesystem carries the registrations. It is mounted on most distributions
# and absent in a minimal container.
if [ ! -d /proc/sys/fs/binfmt_misc ]; then
	$sudo mkdir -p /proc/sys/fs/binfmt_misc
fi
if [ ! -f /proc/sys/fs/binfmt_misc/register ]; then
	$sudo mount -t binfmt_misc none /proc/sys/fs/binfmt_misc
fi

if [ -f "$NODE" ]; then
	echo "APE handler already registered:"
	cat "$NODE"
	exit 0
fi

# Field order is :name:type:offset:magic:mask:interpreter:flags -- type M means
# match the magic bytes, and an empty mask compares them all.
printf ':%s:M::%s::/bin/sh:\n' "$NAME" "$MAGIC" | $sudo tee /proc/sys/fs/binfmt_misc/register >/dev/null

test -f "$NODE" || {
	echo "the handler did not appear at $NODE after registering" >&2
	exit 1
}
echo "registered:"
cat "$NODE"
