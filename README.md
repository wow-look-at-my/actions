# ste-lint

A compatibility wrapper around [slopfix](https://github.com/wow-look-at-my/slopfix). It runs slopfix's hard-wrap and STE rules on the markdown lines a change wrote, and fails on any finding. It holds no rule of its own.

```yaml
- uses: wow-look-at-my/actions@ste-lint#latest
  with:
    files: docs/**/*.md
```

## What fails the run

Any error from these slopfix rules: `wrap/hard-wrap`, `ste/contraction`, `ste/modal`, `ste/semicolon`, `ste/comma-splice` and `ste/sentence-length`. slopfix's own documentation says what each one reads. `slopfix fix <file>` repairs most of them.

## What warns

slopfix reports these as warnings: `ste/instruction-length`, `ste/passive`, `ste/noun-cluster`, `ste/tense`, `ste/dictionary` and `ste/paragraph-length`. Each one reaches the log as an annotation and never fails the run.

## Scope

The action reads the markdown lines the event changed, not the whole repository. A wrap finding sits on the line it names. slopfix places every other finding on the first line of its paragraph. It counts when the change touched any line of that paragraph.

A file inside a submodule, or one marked `linguist-vendored` or `linguist-generated`, belongs to another project and is skipped. When the base commit cannot be read, the action checks every matched file and says so.

## The step guard

The action prints the ref it runs as, so a rolled-back `uses:` reaches the log. It fails if its own step carries `continue-on-error: true`. A step allowed to fail is not a gate. When it cannot read the workflow file to check, it says so at error level.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `files` | `**/*.md` | Glob patterns, separated by whitespace or commas |

Matching no files fails the run. A check that reads nothing passes for the wrong reason.

## Outputs

| Output | Meaning |
| --- | --- |
| `files` | How many files were checked |
| `violations` | How many findings failed the run |
