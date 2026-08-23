# requests.json: an instruction is not done until a command proves it

An instruction arrives, work happens, and a report says it is finished. The report is prose. Nothing re-checks it, and nobody can tell later which instruction was carried out and which was quietly dropped.

`requests.json` removes the prose from that loop. Each instruction is a row. Each row names a command. The command exits 0 only where the instruction actually holds. `check-requests.mjs` runs every command, and the `requests` job in `release.yml` runs that on every push.

## The row

```json
{
  "id": "comment-limit-1",
  "request": "Limit GHA yml files in the chain of callers to at most 1 comment line in a row.",
  "proof": "GITHUB_WORKSPACE=$PWD node yaml-comment-block/dist/index.js",
  "status": "done"
}
```

- `id` is unique. A duplicate fails the build.
- `request` is what was asked, in the words it was asked in.
- `proof` is a shell command that runs from the repo root. It exits 0 only where the request holds.
- `status` must be `done`. Anything else fails the build, and the failure prints the request text.

## What fails the build

- A row with no `proof`. An instruction with no check is an instruction nobody can show was carried out.
- A row whose `proof` command exits non-zero.
- A row whose `status` is not `done`.
- A duplicate `id`, an unreadable file, or an empty list.

## Adding a request

1. Add the row before the work starts, with `status` set to anything except `done`. The build is now red. It names the request.
2. Do the work.
3. Write the proof command. It must fail against the tree before the work, and pass after it. A proof that cannot go red proves nothing.
4. Set `status` to `done`. The build goes green.

## Proving the mechanism itself

`check-requests-helpers/assert-requests-job.mjs` asserts three things. `release.yml` still carries the `requests` job. That job runs `check-requests.mjs`. It carries no `continue-on-error`. A mechanism nothing runs is a mechanism that does not exist.
