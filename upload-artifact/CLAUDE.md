# upload-artifact (cache-backed) -- notes for Claude

## What this is

A node24 action replacing `actions/upload-artifact@v4` on the Actions CACHE
service (the org's artifact storage is quota-blocked; see README.md "Why
cache-backed"). It globs files exactly like upstream (ported search/LCA
logic), tars them with an embedded metadata entry, and `saveCache`s the tar
under a per-run/per-name key. The counterpart is `../download-artifact/`.

## Structure

```
action.yml       inputs/outputs mirroring upstream v4 (+ token, + artifact-key output)
src/shared.ts    THE CONTRACT FILE -- byte-identical twin of download-artifact/src/shared.ts
src/search.ts    ported upstream glob/LCA search (actions/upload-artifact v4.6.2, MIT)
src/lib.ts       name/path validation (ported), no-files behavior, save-failure diagnosis
src/index.ts     the flow
src/*.test.ts    node:test unit tests (run by CI's release-node matrix via tsx)
```

## Build / test

```sh
just build                       # pnpm install + tsc + esbuild bundle to dist/index.js
pnpm tsx --test src/*.test.ts    # unit tests
```

Do NOT commit `dist/`. CI (release.yml) builds, tests, validates, and
publishes the orphan tag `upload-artifact#latest` on every push; the
`test-cache-artifact` job drives the built action against the real cache
service (save, duplicate-save failure, overwrite re-save), and
`test-cache-artifact-download` verifies the pair end to end.

## The ghart-v1 compatibility contract

`src/shared.ts` is duplicated BYTE-FOR-BYTE in `download-artifact/src/` (the
two actions are published as independent orphan tags and cannot import each
other). A test in download-artifact asserts byte-equality. The contract:

- Key: `ghart-v1-<runId>-<sha256(name)[0..16]>-a<runAttempt>-<sanitized name>`
  (sanitize: commas/control/whitespace to `-`, clamp 100; keys stay <= 512
  chars, comma-free). The fixed-length name hash BEFORE the attempt marker is
  what makes the cross-attempt restore prefix `...-<hash16>-a` collision-proof
  against names containing dashes/digits.
- Payload: the CONSTANT workspace-relative path `.gha-cache-artifact.tmp/payload.tar`,
  passed as that literal string to saveCache/restoreCache -- the cache version
  hash covers the paths-as-passed, so byte-identical strings on both sides or
  the restore silently misses. The staging dir is always rm -rf'd in a finally.
- Inside the payload: a plain uncompressed tar whose FIRST entry is
  `.gha-artifact-meta.json` (formatVersion 1), followed by the user files
  rooted per upstream v4 semantics; symlinks dereferenced (`tar -h`).

ANY change to the key format, payload path, tar layout, or meta format bumps
`ghart-v1` to `ghart-v2` in BOTH directories in ONE PR.

## Design invariants

- The payload path stays a constant workspace-relative string (version-hash
  identity by construction). Never absolute, never $RUNNER_TEMP.
- `saveCache` returning -1 is FATAL and always diagnosed (REST-list the exact
  key, then read-only mode, then generic + raw error) -- the lib collapses
  duplicate-key, write-denied, and upload failures into a bare -1, so a
  silent -1 loses the artifact invisibly.
- `ACTIONS_CACHE_MODE` read/none fails fast BEFORE any work, naming the event
  and the writer-event list (workflow_run and friends get read-only cache).
- REST calls are strictly SEQUENTIAL (org doctrine: one GitHub API call at a
  time) and use plain fetch, no octokit. At most one flat retry where the
  design says so; NEVER exponential backoff.
- retention-days / compression-level are accepted-and-ignored with a core.info
  note (call-site compatibility).
- Deps: `@actions/cache` pinned to the `^5.2.0` v5-commonjs line (verified to
  speak the v2 twirp protocol: ACTIONS_CACHE_SERVICE_V2 in its config.js);
  the 6.x line is ESM-only and fights the repo's commonjs tsconfig. Same
  story for `@actions/glob` `^0.5.1` -- 0.6.0+ went ESM-only; 0.5.x is what
  upstream v4.6.2 uses and has excludeHiddenFiles.
