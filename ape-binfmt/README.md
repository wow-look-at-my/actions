# APE binfmt

Registers the Actually Portable Executable format with `binfmt_misc`, so the
kernel execs an APE the way it execs an ELF.

```yaml
- uses: wow-look-at-my/actions@ape-binfmt#latest
  with:
    verify: build/myapp_cosmo_fat
```

## What it fixes

An APE opens with the magic `MZqFpD`, and the same bytes are a PE header, an ELF
header and a shell script at once. The kernel knows none of those layouts, so a
raw `execve` of one answers `ENOEXEC`. That is the "exec format error" a
container entrypoint, a `docker exec`, or Go's `os/exec` reports.

Callers used to route every APE through a shell by hand -- `sh ./myapp`,
`docker exec … sh /usr/local/bin/myapp`. After this action the plain path works.

## The interpreter is /bin/sh, and that is not a workaround

The registration names `/bin/sh` as the interpreter. There is no loader to
download and nothing to keep current: the APE's own header IS the trampoline,
and it locates and runs the right embedded binary for this machine. The kernel's
job here is only to know which files to hand to it.

## Verification needs perl, not a shell

`verify` execs the named binary through perl's raw `execve` syscall. A shell
cannot answer the question: bash retries a file it cannot exec under `/bin/sh`,
and `execvp(3)` -- what node, `env(1)` and most tools call -- does the same. Both
report success whether or not the kernel knows the format, so a check built on
either one can never go red.

## Scope

The registration is per kernel, not per process, and `binfmt_misc` is not
namespaced: a container on the same host inherits it. The interpreter path is
resolved in the container's own mount namespace, so an image with no `/bin/sh`
still needs the `F` flag, which this action does not set.

A published image must therefore keep working on a host that never ran this. Use
this action for the machines you control -- CI runners, a build box -- and keep a
shell in the image for everyone else.
