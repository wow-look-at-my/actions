# Cache Download

Restore files handed off by [`cache-upload`](../cache-upload/) earlier in the same workflow run. It replaces `actions/download-artifact` without an artifact. Artifact storage is billed. Cache storage is not.

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

The entry version is a **constant**, the sha256 of a fixed format-revision literal. It is not the path-spec hash of `actions/cache`, which forces byte-identical path strings on both sides. The **run id comes first** in the key. Every hand-off of one run therefore shares the run-scoped prefix `cache-xfer-<run_id>-`. That is what makes nameless discovery safe. A prefix search scoped to the current run can never match an entry of another run.

The archive is self-describing. A directory hand-off extracts its tree into the destination, with exec bits, symlinks and dotfiles intact. A single-file hand-off recreates `<dest>/<basename>` with its original permission bits. The envelope header carries the hand-off **name**. A nameless download can therefore report exactly which hand-off it restored. zstd and tar come from the runner image. Every GitHub-hosted image ships zstd 1.5.7. Everything is streamed. Nothing is buffered whole in memory.

## Nameless discovery

When `name` is omitted, the action restores **this run's** hand-off by the run-scoped prefix `cache-xfer-<run_id>-` and emits a `::notice` naming the hand-off it picked (read from the envelope header). This removes the need for consumers to know the producing job's hand-off name (e.g. per-job names like `go-build-<job id>`).

**Ambiguity is a hard error, never a silent pick.** Before the download, the action lists this run's entries with the documented REST cache API (`GET /repos/{owner}/{repo}/actions/caches`, prefix-scoped). [`cache-cleanup`](../cache-cleanup/) uses the same endpoint. The pinned `@actions/cache` twirp client has no list RPC. A run that saved **more than one** distinct hand-off name fails the step, and the failure names every candidate. The fix is to pass one of them as `name`, or to stop uploading the extra hand-off. A producer can save an extra alias hand-off, such as a deprecated compatibility name beside the real one. Every nameless download in that run then fails until the alias is dropped. That is deliberate.

The listing needs `actions: read` on the `github-token` input, which defaults to `${{ github.token }}`. A token that cannot list makes discovery **degrade with a warning**. Restricted default permissions and a transient API failure both do this. The newest run-scoped entry is restored. The notice still names what was picked. **A run with several hand-offs must therefore keep passing an explicit `name`**, unless it can rely on the ambiguity check. A named download never touches the token.

Attempts never create ambiguity. Candidate names are deduplicated across `run_attempt`. On "re-run failed jobs", where the producer does not re-run, the run-scoped prefix restores the newest earlier attempt's entry. A named download does the same.

**Nameless mode has no legacy fallback.** An entry saved by a pre-v2 `cache-upload`, in the name-first key layout, is invisible to discovery. A nameless old-layout prefix search is exactly the cross-run bug the run-id-first layout fixed. Pass an explicit `name` to reach such an entry through the transition fallback below.

## Transition fallback (pre-v2 producers)

`#latest` tags move on merge, so a new-layout consumer can briefly run against an old-layout producer mid-rollout. A **named** download that misses under the current layout falls back to the pre-v2 key layout (`cache-xfer-<name>-<run_id>-<attempt>`, v1 entry version) and logs a warning when the fallback fires. This fallback is temporary and will be removed once the rollout is complete.

## Re-runs

- **Re-run failed jobs**: the run gets a new `run_attempt`. The producer job succeeded, so it does not re-run. The exact key misses, and the `<name>-` prefix restores the newest earlier attempt's files. A nameless download uses the run-scoped prefix for the same result.
- **Re-run all jobs**: the producer re-uploads under the new attempt and the exact key matches it.
- Caveat: a [`cache-cleanup`](../cache-cleanup/) job deletes the failed run's entries, because it runs on failure too, by design. After that, "re-run failed jobs" has nothing left to restore. Use "Re-run all jobs".

**A missing hand-off fails loudly by default.** `fail-if-missing` defaults to `true`, so the job aborts instead of continuing without its files. The failure names the hand-off, the keys tried, and the restore prefix. A nameless download names the run-scoped prefix instead of the hand-off. Only an explicit `fail-if-missing: 'false'` lets a miss continue, for a genuinely optional hand-off. Check the `cache-hit` and `cache-matched-key` outputs in that case.

## Stability note

Upload and download drive the twirp v2 endpoints of the cache service directly. They use the job's own `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL`, which the runner injects into every step, so no `permissions:` entry is needed. Driving these endpoints is established practice. docker buildx `--cache-from type=gha` and the GHA backend of sccache do the same. The endpoints are still not a documented public API.

This risk is accepted, not mitigated. GitHub has changed this protocol before. The legacy REST flavor was shut off in 2025 in favor of the twirp service. A bundled pin cannot protect against a server-side shutdown. The next protocol move breaks these actions **loudly**, with RPC errors and failed jobs, never silent corruption. They stay broken until `@actions/cache` is bumped here and the actions are republished. The containment is the release model, not the pin. Every consumer rides the moving `<name>#latest` tags, so the fix lands org-wide from this one repo, and no consumer workflow changes. In 2025 every action pinning an old `@actions/cache` had to update on its own. The pin and the bundle only keep releases hermetic and reviewable. GHES, which runs the v1 cache service, is not supported.

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
