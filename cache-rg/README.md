# Cache rg

A composite GitHub Action that installs [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) by caching the `.deb` from Ubuntu's apt repository and extracting just the `rg` binary each run. Designed to beat the ~15s `sudo apt-get install ripgrep` duration on `ubuntu-latest` runners.

## How It Works

1. **Cache restore** — Looks up `/tmp/cache-rg/ripgrep.deb` under a fixed key.
2. **Download on miss** — `apt-get download ripgrep` fetches the `.deb` (~1 MB). No packages are installed and no postinst scripts are run.
3. **Extract** — `dpkg-deb -x` unpacks the `.deb` into a temp dir, and `usr/bin/rg` is copied to `~/.local/bin/rg`. Runs every time, cache hit or miss; takes well under a second.
4. **PATH** — `~/.local/bin` is added to `GITHUB_PATH` so later steps can call `rg` directly.

Only the `rg` binary is installed. Its runtime deps (`libc6`, `libgcc-s1`, `libpcre2-8-0`) are preinstalled on `ubuntu-latest`, so no extra files are needed.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-rg#latest
- run: rg --version
```

### Outputs

| Name | Description |
|------|-------------|
| `cache-hit` | `true` if the `.deb` was restored from cache |
| `path` | Absolute path to the installed `rg` binary (`$HOME/.local/bin/rg`) |

## Requirements

- **`ubuntu-latest` runner only.** The action fails fast on anything other than Linux + X64 (no macOS, Windows, or arm64).

## Performance

| Scenario | Typical time |
|----------|--------------|
| `sudo apt-get install ripgrep` (no cache) | ~15s |
| `cache-rg` cache miss (download + extract) | ~2–5s |
| `cache-rg` cache hit (extract only) | ~1–2s |
