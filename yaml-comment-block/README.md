# yaml-comment-block

Fail CI when a GitHub Actions YAML file carries **more than 1 comment line in a row**.

A comment that runs to a second line is usually an essay, not a note. The fix is to shorten it to what a reader needs right here — usually one line. Real depth that outlives that line belongs in an existing doc, cited with one line, never in a new file created only to get past this check. A wall of comments moved verbatim into a fresh doc is the same essay in a different place, and it still fails the next reader.

The limit is a constant. There is deliberately no input that raises it. A settable maximum removes the rule instead of configuring it.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: wow-look-at-my/actions@yaml-comment-block#latest
```

## What Gets Scanned

The whole local call chain, with no configuration:

- every workflow file in `.github/workflows/`, reusable workflows included
- every `action.yml` or `action.yaml` in the workspace, at any depth
- everything those files reach through `uses: ./...`, followed transitively

A `uses:` reference to another repository names a file this workspace does not hold. The log lists those refs as `not followed (another repository)`. The check runs where they live.

A local `uses: ./...` that resolves to no file fails the action. Part of the chain is unreadable, so it went unscanned.

## The Rule

A comment line is a line whose first non-whitespace character is `#`. A block is a maximal group of comment lines separated by nothing except blank lines. Two comment lines in one block fail the job.

- Blank lines do not split a block, and do not count toward it. Paragraph breaks do not get a wall past the check.
- A line of content splits a block. One line, a key, one more line is fine.
- A trailing comment after content is not a comment line. `runs-on: ubuntu-latest # fastest` never joins a block.
- A `#` inside a block scalar counts, so a wall of shell comments in a `run:` script fails too. The language of the wall does not matter.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `paths` | No | *(empty)* | Files to scan, newline or comma separated, relative to the workspace. Empty means the automatic discovery above. The scan follows `uses: ./...` from whatever the roots are. |
| `exclude` | No | *(empty)* | Glob patterns for files the scan skips, newline or comma separated. Use it for fixtures that violate the rule on purpose. |

## Output On Failure

Each block is one annotation. It names the file, the count, the span, and the limit:

```
.github/workflows/ci.yml: 9 comment lines in a row (lines 48-56) — the limit is 1. Shorten this to one line. Say only what a reader needs right here. ...
```

An empty scan enforces nothing. No workflow file and no `action.yml` under the workspace gives a warning that names the workspace, never a quiet pass.

## Fixtures

`test/fixtures/clean` sits at the limit and passes. `test/fixtures/wall` carries a two-line block and fails. `release.yml` runs both against the built bundle.
