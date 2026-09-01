# release.yml: why its jobs look the way they do

`.github/workflows/release.yml` builds, dogfoods, and tags every action in this repo. Its job comments stay to one line and point here. This file holds the reasoning behind the parts that look arbitrary.

## checks: cleanup

The cleanup job sweeps release tags that name things which no longer exist. Three shapes are junk. The action directory is gone from the default branch. A branch tag names a branch the remote no longer has. The version suffix is neither a number nor `#latest`.

Existence is judged against the default branch, fetched fresh, never against the checkout. A feature branch that deletes an action must not delete that action's tags on its own run. The default branch is the only referee. The job is therefore safe on every branch push.

A deletion that loses a race against a concurrent run is tolerated with a warning. Every other failure is loud. An unresolvable default branch or a failed tree fetch aborts the job. A blind sweep can delete every tag.

Tags without `#` are kept and logged. Orphan-release never mints them, and a manually created tag may carry a meaning this job cannot know.

## checks: orphan-release

The suite pushes to local bare repositories. It needs no token and no network. It covers what a release does when it loses the race for `#latest`. The numbered tag must publish anyway.

This repo has no go.mod. go-toolchain bundles dats but hard-requires one, so this repo cannot get dats that way. It uses the `wow-look-at-my/dats` action instead, which downloads the binary and makes sure a sandbox backend works.

## checks: secret-server

`export-secrets.sh` is extracted out of `action.yml`, so dats can drive it directly. It needs no OIDC token and no network.

jq.exe on Windows writes CRLF. A key or value read off its stdout then carries a trailing `\r`.

The suite proves this with a fake `jq` that appends `\r` to real jq's output. A negative control proves the suite fails without the strip.

## test-cache-xfer

This is a round-trip for the cache hand-off trio against the real cache service. The steps are upload, nameless discovery, named download, the ambiguity hard-error, and cleanup. Entries are run-scoped, so parallel CI runs never interfere.

## test-no-all-builds-job

The guard must pass on this repo. No job here is ever named `all-builds`. The guard must also fail on the shadowed fixture. The API layers are hard-required. The job grants `actions: read` and `checks: read`, so the passing run exercises them for real. A bogus-token step then proves that a layer which cannot run fails the guard.

The runner refuses a step `env:` override of a `GITHUB_*` variable. The failure path therefore execs the built bundle with a shell-level assignment that points `GITHUB_WORKSPACE` at the fixture. That is the same entry point the action runs. The explicitly empty token takes the documented no-token skip of the API layers. The failure of that step is therefore attributable to the file scan alone.

The success step before it exported the run-once sentinel into the job env. The fixture step clears it explicitly, because an empty value means absent. Without that reset the run skips instead of detecting the fixture violation.

The last two steps prove the two failure modes. A token whose API layers cannot run must fail the guard, even where this repo has no violations. A layer that cannot scan is itself a blocking error, and both layers are reported before the failure. With the sentinel set, the guard must exit 0 on the same violating fixture. The skip wins before any check runs.

## ste-lint

Every `.md` file in this repo goes through `ste-lint`. Sentence length, contractions, banned modal verbs, semicolons, and comma splices fail the job. The heuristics only warn.

## test-yaml-comment-block

Two fixtures run against the built bundle, with `GITHUB_WORKSPACE` pointed at each. `test/fixtures/clean` sits at the one-line limit and must pass. `test/fixtures/wall` carries a two-line block and must fail. The plain `uses: ./yaml-comment-block` step above them checks the repo itself.

Nothing excludes the fixtures from that step. The scan matches `.github/workflows/*.yml` at the workspace root only, and a fixture workflow file sits under `yaml-comment-block/test/fixtures/<name>/.github/workflows/`.

## validate: workflows

Only the workflow files are validated. The `action.yml` files in this repo carry a non-standard `version:` field and `using: node24`. The bundled schema of action-validator rejects both. A non-matching `actions:` glob therefore skips them, because nullglob gives zero iterations. Every workflow, the reusable ones included, is still schema-checked.
