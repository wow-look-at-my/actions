# Cache rg

A composite GitHub Action that installs [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) from apt, caching the extracted binary so subsequent runs skip the apt download entirely. Designed to beat the ~15s `sudo apt-get install ripgrep` duration on GitHub-hosted runners.

## How It Works

1. **Cache restore** — Looks up `~/.local/bin/rg` under a key tied to the runner OS and arch.
2. **Cache miss** — Downloads the `ripgrep` `.deb` with `apt-get download`, extracts it with `dpkg-deb -x`, and installs just `usr/bin/rg` to `~/.local/bin/rg`. No system packages are installed and no postinst scripts are run. Falls back to `sudo apt-get update` only if the initial download fails (stale index).
3. **PATH** — `~/.local/bin` is added to `GITHUB_PATH`, so later steps can call `rg` directly.

Only the `rg` binary itself is cached. Its runtime deps (`libc6`, `libgcc-s1`, `libpcre2-8-0`) are present on standard GitHub-hosted Ubuntu images, so no extra files are required.

## Usage

```yaml
- uses: wow-look-at-my/actions@cache-rg#latest
- run: rg --version
```

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `version-tag` | No | `v1` | Cache version tag; bump to invalidate all cached binaries (e.g. after a distro/ABI change) |

### Outputs

| Name | Description |
|------|-------------|
| `cache-hit` | `true` if the binary was restored from cache |
| `path` | Absolute path to the installed `rg` binary (`$HOME/.local/bin/rg`) |

## Requirements

- **Linux runner** — Uses apt/dpkg; fails fast on Windows and macOS.
- **sudo for fallback only** — Normal operation runs as the regular runner user. `sudo apt-get update` is invoked only if the initial `apt-get download` fails due to a stale package index.

## Performance

| Scenario | Typical time |
|----------|--------------|
| `sudo apt-get install ripgrep` (no cache) | ~15s |
| `cache-rg` cache miss | ~2–8s (depending on whether the apt index needs refreshing) |
| `cache-rg` cache hit | ~1–2s |
