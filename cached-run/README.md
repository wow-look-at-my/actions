# cached-run

Run a script with its output paths restored from cache first and saved after. The cache key is a hash of the script text and the path list. An edit to either one gets you a fresh cache in place of a stale one.

```yaml
- uses: wow-look-at-my/actions@cached-run#latest
  with:
    key: ${{ hashFiles('src/**', 'Cargo.lock') }}
    paths: target/release
    run: |
      cargo build --release
```

## What it does for you

- Puts `set -euo pipefail` in front of your script. A failing command then stops it.
- Adds `touch <sentinel>` at the end and saves the cache only when that file appears. A script that hits its own `exit 0` or an `exec` saves nothing.
- Hashes the full script text, the sorted path list, `runner.os`, `runner.arch` and the `key` input into one digest. A reorder of the paths does not change it.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `run` | required | The script to run. |
| `paths` | required | Output paths to restore then save, one per line. |
| `key` | `''` | Extra text mixed into the digest. Put a lockfile hash here. |
| `restore-keys` | `''` | Fallback prefixes for a partial restore. |
| `working-directory` | `.` | Where to run the script. |
| `skip-on-hit` | `true` | Skip the script on an exact hit. Set it false for a warm cache. |

Outputs: `cache-key`, `cache-hit`, `cache-matched-key`, `skipped`, `cache-saved`.

## Picking a key

The script text is in the digest. The files the script READS are not. A build whose result depends on sources must name them: put `hashFiles(...)` in the `key` input. Without that, an edit to your sources hits the same key and restores a stale build.

## Output cache or warm cache

An exact hit means the same script, the same paths and the same platform produced what is in the cache. Nothing is left to do. The script is therefore skipped, which is the default.

Set `skip-on-hit: false` when the paths FEED the run rather than being its product. A compiler cache such as `ccache` or `~/.cache/go-build` works this way. The restore makes the run faster. The run itself must still happen.

```yaml
- uses: wow-look-at-my/actions@cached-run#latest
  with:
    key: ${{ hashFiles('go.sum') }}
    skip-on-hit: false
    paths: ~/.cache/go-build
    run: go build ./...
```

A `restore-keys` match is a partial result. The script always runs after one, whatever `skip-on-hit` says.

## Tests

`ts0 test` in this directory covers the key logic with no runner and no network. The digest itself lives in `_shared/cache-key`, which `cached-apt` keys on too, and carries its own suite. `cached-run/test` dogfoods the real cache round trip from CI.
