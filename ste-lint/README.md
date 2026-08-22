# ste-lint

Checks prose against the mechanical subset of ASD-STE100, Simplified Technical
English: sentence length, contractions, banned modal verbs, semicolons, and
comma splices fail the run. complex verb tenses, passive voice, long noun clusters, and
dictionary word choice only warn.

```yaml
- uses: wow-look-at-my/actions@ste-lint#latest
  with:
    files: docs/**/*.md
```

## What fails the run

A sentence over `hard-max-words` (25), a contraction, `should`/`shall`/
`could`/`might`/`would` (use `must`/`must not` or `can`), a semicolon, and a
comma that joins two clauses.

**A sentence is measured as a sentence, not as a line.** Prose files are
hard-wrapped, so one sentence normally spans two or three physical lines. A
checker that reads one line at a time sees three short fragments and passes a
30-word sentence, which makes the cap unenforceable on exactly the documents
it is aimed at. Every rule here runs over a paragraph with its lines rejoined,
and each finding still names the line its sentence starts on.

**A comma splice is the banned semicolon, spelled differently.** STE bans the
semicolon because rule 5.3 allows one instruction per sentence, so `A, B`
breaks the same rule as `A; B` and fails the same way. The pattern is narrow
on purpose: the words before the comma must already carry a finite verb, and
the words after it must open a clause with a subject and a finite verb. An
introductory phrase in front of a clause ("Under the alt screen, there is no
scrollback") is ordinary English and is left alone.

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

## The step guard

The action prints the ref it runs as, and it fails if its own step carries
`continue-on-error: true`. A step allowed to fail is not a gate. When it cannot
read the workflow file to check, it says so at error level rather than staying
quiet.

## Running it locally

Pass file patterns and the same code prints the same report, so a finding
count is a command rather than a number somebody remembers:

```sh
node dist/index.js '**/*.md'
```

It exits 1 on a failing finding, 2 when the patterns match nothing.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `files` | `**/*.md` | Glob patterns, separated by whitespace or commas |
| `hard-max-words` | `25` | A sentence longer than this fails |
| `warn-max-words` | `20` | A sentence longer than this warns |

**Neither cap goes above 25.** Rule 6.3 sets that number, so a larger value does
not configure the rule, it removes it from the calling workflow. Either input is
refused above 25, by name. A smaller value is a stricter house style and is
accepted.

Matching no files fails the run. A check that reads nothing passes for the
wrong reason.

## Outputs

| Output | Meaning |
| --- | --- |
| `files` | How many files were checked |
| `violations` | How many findings failed the run |
