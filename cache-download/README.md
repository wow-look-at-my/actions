# Cache Download

Restore files handed off by [`cache-upload`](../cache-upload/) earlier in the same workflow run — an artifact-free replacement for `actions/download-artifact`. Artifact storage is billed; cache storage is not.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-download#latest
  with:
    name: go-build
    path: build/
```

Or, when the run has exactly **one** hand-off, skip the name entirely — it is discovered:

```yaml
- uses: wow-look-at-my/actions@cache-download#latest
  with:
    path: build/
```

`path` is a **real destination directory** (created if missing, default: the workspace). It does not need to match anything the producer did — there is **no path contract** between the two sides.

## How It Works

The hand-off is looked up by key, not by path:

- exact key: `cache-xfer-<run_id>-<name>-<run_attempt>`
- restore-keys prefix: `cache-xfer-<run_id>-<name>-`

with a **constant** entry version (sha256 of a fixed format-revision literal — not `actions/cache`'s path-spec hash, which is what would otherwise force byte-identical path strings on both sides). The **run id comes first** in the key, so every hand-off of one run shares the run-scoped prefix `cache-xfer-<run_id>-` — which is what makes nameless discovery safe: a prefix search scoped to the current run can never match another run's entry.

The archive is self-describing: a directory hand-off extracts its tree into the destination (exec bits, symlinks, dotfiles intact); a single-file hand-off recreates `<dest>/<basename>` with its original permission bits; and the envelope header carries the hand-off **name**, so a nameless download can report exactly which hand-off it restored. zstd and tar come from the runner image (all GitHub-hosted images ship zstd 1.5.7), and everything is streamed — nothing is buffered whole in memory.

## Nameless discovery

When `name` is omitted, the action restores **this run's** hand-off by the run-scoped prefix `cache-xfer-<run_id>-` and emits a `::notice` naming the hand-off it picked (read from the envelope header). This removes the need for consumers to know the producing job's hand-off name (e.g. per-job names like `go-build-<job id>`).

**Ambiguity is a hard error, never a silent pick.** Before downloading, the action lists this run's entries via the documented REST cache API (`GET /repos/{owner}/{repo}/actions/caches`, prefix-scoped — the same endpoint [`cache-cleanup`](../cache-cleanup/) uses; the pinned `@actions/cache` twirp client has no list RPC). If the run saved **more than one** distinct hand-off name, the step fails, naming every candidate, so the fix is obvious: pass one of them as `name`, or stop uploading the extra hand-off. (Note: a producer that saves an extra alias hand-off — e.g. a deprecated compatibility name alongside the real one — makes every nameless download in that run fail until the alias is dropped; that is deliberate.)

The listing needs the `github-token` input (defaults to `${{ github.token }}`) to have `actions: read`. If the token cannot list (restricted default permissions, transient API failure), discovery **degrades with a warning**: the newest run-scoped entry is restored and the notice still names what was picked — so **runs with multiple hand-offs must keep passing an explicit `name`** unless they can rely on the ambiguity check. Named downloads never touch the token.

Attempts never create ambiguity: candidate names are deduplicated across `run_attempt`, and on "re-run failed jobs" (producer not re-run) the run-scoped prefix restores the newest earlier attempt's entry, exactly like a named download.

**No legacy fallback in nameless mode**: entries saved by a pre-v2 `cache-upload` (name-first key layout) are invisible to discovery — a nameless old-layout prefix search is exactly the cross-run bug the run-id-first layout fixed. Pass an explicit `name` to reach them via the transition fallback below.

## Transition fallback (pre-v2 producers)

`#latest` tags move on merge, so a new-layout consumer can briefly run against an old-layout producer mid-rollout. A **named** download that misses under the current layout falls back to the pre-v2 key layout (`cache-xfer-<name>-<run_id>-<attempt>`, v1 entry version) and logs a warning when the fallback fires. This fallback is temporary and will be removed once the rollout is complete.

## Re-runs

- **Re-run failed jobs**: the run gets a new `run_attempt`, but the producer job (which succeeded) does not re-run — the exact key misses and the `<name>-` prefix (or the run-scoped prefix, nameless) restores the newest earlier attempt's files.
- **Re-run all jobs**: the producer re-uploads under the new attempt and the exact key matches it.
- Caveat: if a [`cache-cleanup`](../cache-cleanup/) job already deleted the failed run's entries (it runs on failure too, by design), "re-run failed jobs" has nothing left to restore — use "Re-run all jobs".

**A missing hand-off fails loudly by default**: `fail-if-missing` defaults to `true`, so the job aborts instead of silently continuing without its files — the failure names the hand-off (or the run-scoped prefix, nameless), the keys tried, and the restore prefix. Only an explicit `fail-if-missing: 'false'` lets a miss continue (for a genuinely optional hand-off); check the `cache-hit` / `cache-matched-key` outputs in that case.

## Stability note

Upload and download drive the cache service's twirp v2 endpoints directly (with the job's own `ACTIONS_RUNTIME_TOKEN` / `ACTIONS_RESULTS_URL`, which the runner injects into every step — no `permissions:` needed). Driving these endpoints is established practice (docker buildx `--cache-from type=gha` and sccache's GHA backend do the same), but they are not a documented public API.

Known risk, deliberately accepted rather than mitigated: GitHub has changed this protocol before — the legacy REST flavor was shut off in 2025 in favor of the twirp service — and a bundled pin cannot protect against a server-side shutdown. When the protocol moves again, these actions break **loudly** (RPC errors → failed jobs, never silent corruption) until `@actions/cache` is bumped here and the actions republished. The actual containment is the release model, not the pin: every consumer rides the moving `<name>#latest` tags, so the fix lands org-wide from this one repo without touching consumer workflows — unlike 2025, where every action pinning an old `@actions/cache` had to update independently. The pin/bundle itself just keeps releases hermetic and reviewable. GHES (v1 cache service) is not supported.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | No | discover | Hand-off name used by the matching `cache-upload` step; omit to discover this run's single hand-off (multiple hand-offs: hard error naming candidates when listable, else newest-entry restore with a warning) |
| `path` | No | workspace | Destination directory to restore into (created if missing) |
| `fail-if-missing` | No | `true` | Fail the job if the hand-off is not found (only an explicit `false` lets a miss continue) |
| `github-token` | No | `${{ github.token }}` | Used only by nameless discovery's ambiguity check (REST cache list; needs `actions: read`) |

## Outputs

| Name | Description |
|------|-------------|
| `download-path` | Absolute path of the directory the files were restored into |
| `cache-hit` | `true` on an exact key match (same run attempt); `false` when restored from an earlier attempt |
| `cache-matched-key` | Cache key actually restored (empty on a miss) |
| `name` | Hand-off name actually restored (the input name, or the discovered one; empty on a miss) |
