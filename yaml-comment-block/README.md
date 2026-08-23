# yaml-comment-block

Fail CI when a GitHub Actions YAML file carries **more than 3 comment lines in a row**.

A comment block that runs past three lines is a document with a `#` on every line. It sits in the file forever, it is re-read on every pass, and nothing checks whether it is still true. Keep the lines that stop the next mistake and move the rest into a doc beside the file.

The limit is a constant. There is deliberately **no input that raises it** — a settable maximum removes the rule instead of configuring it.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: wow-look-at-my/actions@yaml-comment-block#latest
```

## What Gets Scanned

The whole local call chain, with no configuration:

- every workflow file in `.github/workflows/`, including reusable ones;
- every `action.yml` / `action.yaml` in the workspace, at any depth — each one is an entry point a caller in another repository reaches;
- everything those files reach through `uses: ./...`, followed transitively.

A `uses:` reference to another repository names a file this workspace does not hold. Those refs are listed in the log as `not followed (another repository)`, and the check runs where they live.

A local `uses: ./...` that resolves to no file fails the action: part of the chain could not be read, so it went unscanned.

## The Rule

A comment line is a line whose first non-whitespace character is `#`. A block is a maximal group of comment lines separated by nothing except blank lines. Four comment lines in one block fail the job.

- **Blank lines do not split a block**, and do not count toward it. Breaking a wall into paragraphs does not get it past the check.
- **A line of content splits a block.** Three lines, a key, three more lines is fine.
- **A trailing comment after content is not a comment line.** `runs-on: ubuntu-latest # fastest` never joins a block.
- **A `#` inside a block scalar counts**, so a wall of shell comments in a `run:` script is caught too. The rule is about walls of prose; the language the wall is written in does not matter.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `paths` | No | *(empty)* | Files to scan, newline or comma separated, relative to the workspace. Empty means the automatic discovery above. The scan follows `uses: ./...` from whatever the roots are. |
| `exclude` | No | *(empty)* | Glob patterns for files the scan skips, newline or comma separated. Intended for fixtures that violate the rule on purpose. |

## Output On Failure

Each block is one annotation naming the file, the count, the span, and the limit:

```
.github/workflows/ci.yml: 9 comment lines in a row (lines 48-56) — the limit is 3.
```

An empty scan — no workflow file and no `action.yml` under the workspace — enforces nothing, so it emits a warning naming the workspace instead of a quiet pass.

## Fixtures

`test/fixtures/clean` sits at the limit and passes. `test/fixtures/wall` carries a four-line block and fails. `release.yml` runs both against the built bundle.
