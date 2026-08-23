# Fixtures

Real prose that broke this checker, kept as the document it broke on.

Each file opens with an `expect:` comment naming the counts the checker must
report for it. `src/fixtures.test.ts` walks the directory and compares. A file
with no `expect:` header fails the run, so a fixture nobody asserts on cannot
sit here looking like coverage.

Every one of these came from linting a hard-wrapped specification, not from
imagination. The two kinds are equally worth keeping. The first is a rule that
fired on correct prose. The second is a rule that stayed silent on prose it was
written to catch.
