# ste-lint

Checks prose against the mechanical subset of ASD-STE100, Simplified Technical
English: sentence length, contractions, banned modal verbs, and semicolons
fail the run; complex verb tenses, passive voice, long noun clusters, and
dictionary word choice only warn.

```yaml
- uses: wow-look-at-my/actions@ste-lint#latest
  with:
    files: docs/**/*.md
```

## What fails the run

A sentence over `hard-max-words` (25), a contraction, `should`/`shall`/
`could`/`might`/`would` (use `must`/`must not` or `can`), and a semicolon.

## What only warns

Sentence length in the band between the two caps, passive voice, long noun
clusters, a complex verb tense (perfect, future perfect, or progressive --
STE approves only the infinitive, the imperative, and the three simple
tenses), a paragraph over six sentences (a list line never counts, matching
the standard's own convention), and a word the ASD-STE100 dictionary does
not approve (extracted from the standard's free PDF -- see
`docs/ste-lint-spec-mapping.md` for what was deliberately left out and why,
including words this checker cannot safely flag because they are approved
under one sense and banned under another, like "as"). Each of these is a
heuristic with real false positives, and a check people learn to ignore is
worse than no check at all.

## What it cannot check

Every writing rule that needs real semantic judgment rather than a pattern --
for example, whether a sentence has one topic or two, or whether an omitted
article is genuinely ambiguous. See `docs/ste-lint-spec-mapping.md` for the
full rule-by-rule mapping, including why each unchecked rule stays unchecked.

ASD's own FAQ says it does not endorse a tool "claimed to be 'fully
compliant'" with the standard. This action does not claim that either.

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
