# ste-lint

Checks prose against the mechanical subset of ASD-STE100, Simplified Technical
English: sentence length, contractions, and `should`/`shall`.

```yaml
- uses: wow-look-at-my/actions@ste-lint#latest
  with:
    files: docs/**/*.md
```

## What fails the run

- **A sentence over `hard-max-words` (25).** That is STE's own outer bound, for
  a description. An instruction caps at 20, which is what `warn-max-words`
  reports.
- **A contraction.** STE bans every one.
- **`should` or `shall`.** STE states an obligation with `must` and `must not`.

## What only warns

Sentence length in the band between the two caps, passive voice, and long noun
clusters. Each is a heuristic with real false positives, and a check people
learn to ignore is worse than no check at all.

## What it cannot check

Word choice. STE's approved-word dictionary is a licensed commercial document
with no free machine-readable copy, so a word outside it passes here. Treat
that part as a convention.

## What it does not read

A heading, a blockquote, a table row, a fenced or inline code span, and any
text inside double quotes. A quotation is another voice, and code is not
prose. Blanking rather than deleting them keeps every finding pointing at the
line it came from.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `files` | `**/*.md` | Glob patterns, separated by whitespace or commas |
| `hard-max-words` | `25` | A sentence longer than this fails |
| `warn-max-words` | `20` | A sentence longer than this warns |

Matching no files fails the run. A check that reads nothing passes for the
wrong reason.

## Outputs

| Output | Meaning |
| --- | --- |
| `files` | How many files were checked |
| `violations` | How many findings failed the run |
