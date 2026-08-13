# Run dats

Download the [dats](https://github.com/wow-look-at-my/dats) binary from
buildhost and run it, so a caller's workflow doesn't have to hand-roll the
`curl`/`chmod` dance.

## Usage

```yaml
- uses: wow-look-at-my/actions@dats#latest
  with:
    args: --no-sandbox test tests/
```

### From a non-default working directory

```yaml
- uses: wow-look-at-my/actions@dats#latest
  with:
    args: test tests/
    working-directory: frontend
```

### Pin a specific dats release

```yaml
- uses: wow-look-at-my/actions@dats#latest
  with:
    args: --version
    version: v3
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `args` | Yes | — | Arguments passed to `dats` |
| `working-directory` | No | `.` | Directory to run `dats` from |
| `version` | No | Newest on the default branch | `dats` release version to download |

## Outputs

| Name | Description |
|------|-------------|
| `path` | Full path to the downloaded `dats` binary |

os/arch are not exposed as inputs: they default to the runner's own platform
via [`buildhost-download`](https://github.com/wow-look-at-my/buildhost/tree/master/.github/actions/buildhost-download),
which this action wraps.
