#!/usr/bin/env bash
# Prove the registration works, on the caller's own binary.
#
# A shell cannot prove it: bash retries a file it cannot exec under /bin/sh, and
# execvp(3) -- which node, env(1) and most tools reach for -- does the same. Both
# succeed whether or not the kernel knows the format. perl's raw execve syscall
# does not retry, so it answers the actual question.
#
# see ape-binfmt/README.md
set -euo pipefail

bin="${APE_VERIFY:?APE_VERIFY must name an APE to exec}"
test -x "$bin" || {
	echo "verify: $bin is not executable" >&2
	exit 1
}
head -c 6 "$bin" | grep -q MZqFpD || {
	echo "verify: $bin does not open with the APE magic MZqFpD" >&2
	exit 1
}

perl -e '
	my $SYS_execve = 59;   # x86_64
	my $path = $ARGV[0] . "\0";
	my $argv = pack("Q", 0);
	my $envp = pack("Q", 0);
	syscall($SYS_execve, $path, $argv, $envp);
	print STDERR "raw execve of $ARGV[0] failed: $!\n";
	exit 111;
' "$bin" >/dev/null 2>verify.err || {
	status=$?
	# 111 is the perl above reporting ENOEXEC. Anything else is the binary
	# itself running and exiting, which is the proof we wanted.
	if [ "$status" -eq 111 ]; then
		cat verify.err >&2
		echo "the kernel still cannot exec an APE -- the handler did not take" >&2
		exit 1
	fi
}
rm -f verify.err
echo "the kernel execs $bin directly"
