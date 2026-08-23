# release.yml: why its jobs look the way they do

`.github/workflows/release.yml` builds, dogfoods, and tags every action in this repo. Its job comments stay short and point here. This file holds the reasoning behind the parts that look arbitrary.

## test-orphan-release

The suite pushes to local bare repositories, so it needs no token and no network. It covers what a release does when it loses the race for `#latest`: the numbered tag must publish anyway.

dats is fetched directly rather than through go-toolchain, which bundles it but hard-requires a `go.mod` this repo does not have. bubblewrap is dats' native Linux backend, and ubuntu denies unprivileged user namespaces by default, which is what the `sysctl` re-enables. Without a backend dats fails rather than running the commands unsandboxed.

## test-cache-xfer

A dogfood round-trip for the cache hand-off trio against the REAL cache service: upload, then nameless discovery, then named download, then the ambiguity hard-error, then cleanup. Entries are run-scoped, so parallel CI runs never interfere.

## test-no-all-builds-job

The guard must pass on this repo (no job is ever named `all-builds` here) and fail on the shadowed fixture. The API layers are hard-required: the job grants `actions: read` and `checks: read` so the passing run exercises them for real, and a bogus-token step asserts that layers which cannot run fail the guard.

The runner refuses to override `GITHUB_*` variables through a step `env:` block, so the failure path execs the built bundle with a shell-level assignment pointing `GITHUB_WORKSPACE` at the fixture — the same entry point the action runs. The explicitly empty token takes the documented no-token skip of the API layers, so that step's failure is attributable to the file scan alone. The success step before it exported the run-once sentinel into the job env, so the fixture step clears it explicitly (empty means absent); otherwise the run would skip instead of detecting the fixture violation.

The last two steps are proofs of the failure modes. With a token whose API layers cannot run, the guard must fail even though this repo has no violations — a layer that cannot scan is itself a blocking error, and both layers are reported before the failure. With the sentinel set, the guard must exit 0 on the same violating fixture: the skip wins before any check runs.

## test-yaml-comment-block

Two fixtures, both run against the built bundle with `GITHUB_WORKSPACE` pointed at them. `test/fixtures/clean` sits at the three-line limit and must pass. `test/fixtures/wall` carries a four-line block and must fail. The repo's own files are checked by the plain `uses: ./yaml-comment-block` step above them.

Nothing excludes the fixtures from that step: the scan matches `.github/workflows/*.yml` at the workspace root only, and a fixture's workflow file sits under `yaml-comment-block/test/fixtures/<name>/.github/workflows/`.

## validate-workflows

Only the workflow files are validated. The repo's `action.yml` files carry a non-standard `version:` field (vestigial — release versions now auto-increment from the existing tags) and `using: node24`, both of which action-validator's bundled schema rejects. A non-matching `actions:` glob skips them (nullglob gives zero iterations) while every workflow, including the reusable ones, is schema-checked.
