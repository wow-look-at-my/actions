# ste-lint's rule mapping (ASD-STE100, Issue 9, 2025-01-15)

This is the full mapping from each check in `ste-lint/src/lint.ts` to the
writing rule in Part 1 of ASD-STE100 that it enforces, and why the rules that
are not checked are not checked. Source: the free PDF at
`https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf`.

## Checked

| Check | Severity | Rule | Note |
| --- | --- | --- | --- |
| Sentence over 25 words | fail | 6.3 | 25 is the descriptive-writing cap |
| Sentence over 20 words | warn | 5.1 | 20 is the procedural cap; this action cannot reliably tell an instruction from a description, so it warns at 20 and fails at 25 |
| Contraction | fail | 4.2 | closed word list, zero ambiguity |
| `should` / `shall` / `could` / `might` / `would` | fail | dictionary: MUST (v), and the "Do not use COULD (v)" note under CAN (v) | `should`/`shall`/`might`/`would` are simply absent from the dictionary; `may` is excluded on purpose (calendar month collision) |
| Semicolon | fail | 8.1 | STE allows every standard punctuation mark except this one |
| Parenthetical text counted as one word | correctness fix, not a new check | 8.5 | without this, `(refer to paragraphs 2 thru 5)` would inflate a sentence's word count against the 20/25 caps |
| Noun cluster of 4+ content words | warn | 2.1 | "no more than three words"; warn because the stopword list is a heuristic |
| Passive voice (`is`/`was`/... + `-ed`) | warn | 3.6 | warn because rule 3.6 itself permits passive voice when the agent is unknown, which this regex cannot tell |
| Perfect / future perfect tense (`has`/`have`/`had`/`will have` + participle) | warn | 3.2, 3.4 | warn, not fail, because "have" + a word ending in "-ed" is also the ordinary "have + adjective + noun" pattern ("have limited options"), which is not perfect tense |
| Progressive tense (`is`/`are`/`was`/`were` + `-ing`) | warn | 3.2, 3.5 | excludes the STE-approved adjective/pronoun/preposition "-ing" words (`mating`, `missing`, `remaining`, `something`, `during`) right after a bare "to be"; does NOT exclude the approved noun forms (`lighting`, `opening`, `routing`, `servicing`), because without an article ("is opening", not "is an opening") that spelling almost always signals the banned progressive verb, not the noun |
| Word not approved in the dictionary (rule 1.1-1.3) | warn | Part 2 (Dictionary) | see "The dictionary check" below |
| Paragraph over 6 sentences | warn | 6.6 | a list line never adds to the count -- see "The paragraph-length check" below |

## The dictionary check

`src/ste100-banned-words.ts` is extracted from the free PDF at
`asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf` (no login, no paywall) --
Part 2 of the standard, the ~2,100-entry alphabetical dictionary (about 900
approved words, about 1,200 banned words each with a suggested replacement).
Only the word and its suggested replacement(s) are extracted, never ASD's
approved-meaning prose or STE/non-STE example sentences, which are their
creative writing and not factual data.

The extraction is narrowed on purpose:

- **A word is dropped if it is also approved under some other sense.** For
  example "as" is banned as a conjunction ("do it as you go") but approved as
  a preposition ("used as a spacer"). This checker matches text, not part of
  speech, so it cannot tell the senses apart, and a checker that cannot tell
  the senses apart must not flag the word at all.
- **`should`/`shall`/`could`/`might`/`would`/`may` are excluded.** These are
  already covered precisely by the hand-coded modal-verb check above.
- **Entries the parser could not confidently read are dropped, not guessed
  at.** A handful of multi-word headwords ("provided that", "so that") and a
  few entries whose alternative wording did not match a clean `WORD (pos)`
  pattern are left out. A silently-wrong "not approved" verdict is worse than
  a missed one.

Even with that narrowing, this stays a warning, never a failure, for a
concrete reason visible in this very repo: STE bans generic-English "action"
in favor of "step"/"procedure"/"task", and this repository's own domain
vocabulary is GitHub *Actions*. A context-blind word match cannot tell a
banned generic noun from an approved technical noun (rule 1.5-1.9 explicitly
allows company- and industry-specific technical nouns outside the general
dictionary) -- so a repo full of "run the action" will see this warning
often. That is expected, not a parsing bug.

To regenerate after a new ASD-STE100 issue: download the PDF, run
`pdftotext -layout` on it, and parse the `Part 2 – Dictionary` section for
lines that open at column 0 with `word (pos)` -- lowercase word = not
approved, uppercase = approved -- collecting indented `WORD (pos)`
continuation lines as suggested alternatives for a not-approved entry. Apply
the same narrowing as above before regenerating `ste100-banned-words.ts`.

## The paragraph-length check

Rule 6.6's own worked example counts an entire introductory sentence plus its
vertical list as ONE sentence, not one sentence per list line. This repo's
Markdown is full of long bulleted lists, so naively counting one sentence per
list line would make this warning fire constantly on ordinary, compliant
docs. The fix: a line matching the list-marker pattern (`- `, `* `, `1. `,
...) never adds to a paragraph's sentence count; the paragraph's own intro
line (usually ending in a colon, with no `.`/`!`/`?` to split on) already
supplies the one sentence the list belongs to, matching the standard's
convention directly instead of approximating it.

## Not checked, and why

- **One topic per sentence (rule 4.1).** Detecting "does this sentence
  contain one idea or two" needs semantics this tool does not have.
- **One instruction per sentence (rule 5.2).** The rule's own examples show
  joining two instructions with "and" is CORRECT when the actions happen at
  the same time ("Hold the panel in its open position and install the
  fastener") and WRONG otherwise. A mechanical "flag every 'and' between two
  verbs" check would fail the compliant examples in the standard itself.
- **Omitted words (rule 4.2, the non-contraction half).** Telling "a sentence
  is missing its subject" from "a sentence has no subject because it is an
  imperative" needs a parser this tool does not have.
- **Articles (rule 4.5).** The rule gives worked examples where dropping an
  article is correct ("Solvents can cause damage to paint" -- no article,
  because it is a general statement) and examples where an article is
  required. A missing-article heuristic would fail the standard's own
  compliant examples.
- **"Every word must be in the approved list" (rule 1.1-1.3, the other
  direction from the dictionary check above).** Rule 1.5-1.9 explicitly
  permits technical nouns specific to a company, industry, or subject field
  outside the general dictionary. A blanket "not in the list" check would
  flag exactly that permitted vocabulary -- this repo's own `action` (GitHub
  Actions), `runner`, `workflow`, and so on -- so it would be actively wrong
  per the standard, not just noisy. The banned-word-with-suggested-
  replacement check above is the direction that stays accurate.
