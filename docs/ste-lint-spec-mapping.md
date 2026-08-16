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

## Not checked, and why

- **Word choice against the approved dictionary (rule 1#).** The dictionary
  (Part 2 of the standard) is a document you request from ASD
  (`asd-ste100.org/STE_downloads.html`), not a file this action can vendor or
  scrape into a word list. There is no indication ASD licenses redistribution
  of it, and the standard's own FAQ explicitly declines to endorse a tool
  claiming to be "fully compliant" -- so this stays a convention, checked by a
  human, not a regex.
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
- **Max six sentences per paragraph (rule 6.6).** Mechanically checkable in
  principle, but the standard's own worked example counts an entire
  introductory sentence plus its vertical list as ONE sentence. This repo's
  Markdown is full of long bulleted lists; naively counting one sentence per
  list line would make this warning fire constantly on ordinary, compliant
  docs, and a check people learn to ignore is worse than no check. Left
  unimplemented rather than shipped noisy.
