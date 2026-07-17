# download-artifact (cache-backed) -- notes for Claude

## What this is

A node24 action replacing `actions/download-artifact@v4` (single-named-artifact
case) on the Actions CACHE service. It restores the payload tar saved by
`../upload-artifact/` (exact key first, cross-attempt prefix fallback), logs
the embedded metadata and payload sha256, extracts everything except the meta
entry to the target path, and on a miss runs a LOUD three-step REST diagnosis
before failing. See `../upload-artifact/CLAUDE.md` and both READMEs for the
why.

## Structure

```
action.yml                  input surface mirroring upstream v4; unsupported inputs rejected loudly
src/shared.ts               THE CONTRACT FILE -- byte-identical twin of upload-artifact/src/shared.ts
src/lib.ts                  unsupported-input rejection, repo-scope check, miss-verdict builder
src/index.ts                the flow
src/shared-parity.test.ts   the byte-equality guard (reads ../../upload-artifact/src/shared.ts)
src/lib.test.ts             miss-verdict cases with injected fake REST data (never real network)
src/extract.test.ts         extraction side of the payload round-trip
```

## Build / test

```sh
just build                       # pnpm install + tsc + esbuild bundle to dist/index.js
pnpm tsx --test src/*.test.ts    # unit tests
```

Do NOT commit `dist/`. CI (release.yml) builds, tests, validates, and
publishes the orphan tag `download-artifact#latest` on every push; the
`test-cache-artifact-download` job restores what `test-cache-artifact`
uploaded on another runner, diffs the tree, asserts the loud failure of a
nonexistent name, and REST-deletes the run's selftest cache entries.

## The ghart-v1 compatibility contract

`src/shared.ts` is duplicated BYTE-FOR-BYTE from `upload-artifact/src/shared.ts`
(independent orphan tags cannot import each other); `shared-parity.test.ts`
enforces the equality, so a one-sided edit fails CI. The contract:

- Key: `ghart-v1-<runId>-<sha256(name)[0..16]>-a<runAttempt>-<sanitized name>`;
  the exact key is tried first, then the cross-attempt prefix
  `ghart-v1-<runId>-<hash16>-a` (prefix restores pick the newest match, i.e.
  the latest previous attempt).
- Payload: the CONSTANT workspace-relative string
  `.gha-cache-artifact.tmp/payload.tar` passed to restoreCache -- the cache
  version hash covers the paths-as-passed, so both actions must pass the
  byte-identical literal or restores silently miss. Staging always rm -rf'd
  in a finally.
- Inside: plain tar, first entry `.gha-artifact-meta.json` (read with
  `tar -x -O`, excluded from extraction via `--exclude`).

ANY change to the key format, payload path, tar layout, or meta format bumps
`ghart-v1` to `ghart-v2` in BOTH action directories in ONE PR.

## Design invariants

- A restore miss is NEVER silent: three sequential REST reads (exact key
  across refs; the run's saved keys; cache usage), each degrading gracefully
  on 401/403/404, then setFailed with a one-paragraph verdict
  (`buildMissVerdict` in lib.ts -- pure and unit-tested with fake data).
- Exactly ONE flat retry, only on a THROWN restoreCache error (never on a
  clean miss); NEVER exponential backoff.
- REST calls strictly SEQUENTIAL, plain fetch, no octokit.
- `pattern` / `merge-multiple` / `artifact-ids` are accepted-but-rejected
  loudly (a call site relying on them must be converted deliberately, never
  silently mis-served); a foreign `repository` fails (repo-scoped); an empty
  `name` fails with the no-download-all explanation.
- Deps: `@actions/cache` pinned to the `^5.2.0` v5-commonjs line (v2 twirp
  protocol verified; 6.x is ESM-only and fights the commonjs tsconfig).
