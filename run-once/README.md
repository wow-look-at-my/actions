# run-once

Claim a workflow run for one job. The work behind the claim then runs once per run instead of once per job.

## Usage

```yaml
steps:
  - id: claim
    uses: wow-look-at-my/actions@run-once#latest
    with:
      name: common-checks
  - if: steps.claim.outputs.first == 'true'
    run: ./expensive-repo-wide-check.sh
```

## The Claim

The claim is a cache entry under the key `run-once-<run_id>-<run_attempt>-<name>`. `CreateCacheEntry` on the cache service refuses a key that exists, and that refusal is the mutex. The winner uploads a few bytes and finalizes the entry, so every later job sees a stored claim rather than a reservation in flight.

Run id and run attempt are part of the key, so a re-run of failed jobs claims afresh. A claim of one name never blocks a claim of another.

The cache service takes the runner's own `ACTIONS_RUNTIME_TOKEN`, so a caller grants no `permissions:` for this. Cache entries are scoped to the branch, and every job of one run shares that scope.

## Failure Runs The Work

`first` is `true` for every failure the cache service reports, each with a warning that names the key:

- the service is unreachable, or the runner has no v2 cache service
- the claim is refused and no entry of that key exists, which is what a read-only cache policy looks like
- the reservation carries no upload URL, or the upload or the finalize fails

Skipping work everywhere because a cache call failed hides whatever that work reports. Running it twice costs seconds. Only a refusal with a stored entry to show for it returns `first: false`.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `name` | Yes | *(none)* | Claim name, unique per piece of work. Commas are invalid in cache keys, so a name that carries one is rejected. |

## Outputs

| Name | Description |
|------|-------------|
| `first` | `true` in the job that holds the claim, `false` in every other job of the run |
| `key` | Cache key the claim was stored under |
