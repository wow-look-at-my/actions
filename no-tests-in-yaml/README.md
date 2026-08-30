# No Tests In YAML

Fails CI when a GitHub Actions YAML file carries a test instead of invoking the repository's own suite.

A workflow step is a scheduler. A test written inside one runs only on a runner, and only after a push. It runs only in that one repository. An engineer cannot run it, debug it, or re-run it before sending a change. This action finds those tests. It names the remedy: move the assertion into the suite the repository already has. The step then invokes that suite.

```yml
- uses: wow-look-at-my/actions@no-tests-in-yaml#latest
```

## What counts as a test

Every rule reads a `run:` script. The rules examine nothing else in the file. A step that merely runs a command matches nothing. A build that fails on its own exit code is not an assertion.

| Rule | Fires on |
|---|---|
| `test-file-written` | A redirect or heredoc whose target is a test file by name: `*_test.go`, `*.test.ts`, `*.spec.js`, `test_*.py`, `*_spec.rb`, `*Test.java`, `*.dats`, `conftest.py`, and the same shapes for the other languages. |
| `assertion` | A comparison paired with a failure on one line: `grep -q … \|\| exit 1`, `if ! grep …`, `[ "$x" = "$y" ] \|\| { … }`, `diff … && echo "::error::…"`, or a line that both annotates an error and exits nonzero — the shape a `case` arm uses. |
| `assert-helper` | A shell function named `assert*`, `expect*`, `require*`, `must*`, `fail_if*` or `check_that*`. A workflow that grows its own assertion vocabulary is a test framework with no test runner. |

## What it does not catch

The assertion rules read one line at a time. A test spread across several lines, with no comparison on any of them, goes unseen. One example is a `case` arm whose error annotation and its `exit 1` sit on separate lines. An action validates its own inputs with that same shape. Input validation is not a test. The text of one line cannot tell the two apart. Silence from this action is not proof that a workflow holds no test.

## What it scans

The whole local call chain, the same way `yaml-comment-block` does: every workflow file, every `action.yml` at any depth, and everything they reach through `uses: ./…`. A `uses:` into another repository is listed in the log and checked where it lives.

An empty scan is a warning, not a pass. A repository that runs this action has at least one workflow file. Nothing to scan means the workspace is not the repository. The usual cause is a missing checkout.

## Inputs

| Input | Description |
|---|---|
| `paths` | Files to scan, newline or comma separated. Empty scans the whole workspace. The call chain is followed from whatever the roots are. |
| `exclude` | Glob patterns the scan skips, newline or comma separated. For fixtures that break the rule on purpose. |

There is no input that turns a rule off. A settable rule removes the rule instead of configuring it, and a check that can be routed around earns a stricter replacement rather than compliance.

## Where the test goes instead

Wherever the repository already runs its suite. A Go repository has `_test.go` files and `go-toolchain`. A repository with a CLI has `dats/*.dats`. A Node action here has `src/*.test.ts`. The step that used to hold the assertion invokes that suite instead, which is one line and runs everywhere.

Staging a fixture is part of the suite too. A dats file writes its module with `inputs.files` and copies binaries in with `inputs.copy`. A Go test writes its fixture in `TestMain`. A heredoc in a workflow is the one place that fixture cannot be re-run.
