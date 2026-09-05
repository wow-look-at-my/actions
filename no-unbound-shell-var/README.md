# No Unbound Shell Var

A bash step that starts with `set -u` stops at the first name that has no value. The step prints `EXCLUDE: unbound variable` and exits 1. Nothing else in the step runs. This check reads each workflow file and each `action.yml` in the repository. It fails CI on that name, before a runner finds it.

```yml
- uses: wow-look-at-my/actions@no-unbound-shell-var#latest
```

## What it counts as a value

A name passes when any one of these gives it a value.

- An `env:` block at any depth in the same file. That scope is deliberate. A step that reads a different step's `env:` is a separate defect. An incorrect scope walk stops a good build, which costs more.
- An input of a composite action, which the runner supplies as `INPUT_<NAME>`.
- A write to `$GITHUB_ENV`, on one line or in a heredoc.
- An assignment in the script itself. This includes `for NAME in`, `read -r NAME`, `local NAME=` and `${NAME:=default}`.
- The runner's own environment: `GITHUB_*`, `RUNNER_*`, `ACTIONS_*`, `HOME`, `CI` and the rest of the image's variables.
- A default in the reference: `${NAME:-}`, `${NAME-x}`, `${NAME:+x}` and `${NAME:?message}`.

A positional parameter and a special parameter are the shell's own. `$1`, `$@`, `$?` and `$$` are never reported.

## What it leaves alone

- A step with no `set -u`, `set -eu`, `set -euo pipefail` or `set -o nounset`. Without one of those a missing name is an empty string, which is a different problem.
- A step whose `shell:` is not `bash` or `sh`.
- A step that cancels nounset with `set +u`. The check cannot say which references the flag covers after that point. It reports the skip and examines nothing more in that step.
- A name in single quotes, in a comment, or in a heredoc with a quoted delimiter. None of those expand.
- A name in `$(( ))`. Arithmetic reads a bare name, and a bare name there gives too many false reports.

## Inputs

Both are optional. `paths` names the files to scan, and replaces the default walk over the workspace. `exclude` takes glob patterns for files the scan skips, and exists for a fixture that breaks the rule on purpose.
