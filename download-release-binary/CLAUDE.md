# Download Release Binary

## Overview

Node.js action (TypeScript) that downloads platform-specific binaries. Tries buildhost (https://pazer.build) first, falls back to GitHub Releases.

## Structure

- `action.yml` — Action definition
- `src/index.ts` — TypeScript source
- `justfile` — Build recipes (`just build`)
- `package.json` — Dependencies (no `scripts` section)

## Development

This is a Node.js action. Do NOT commit `dist/` or built JS files — CI builds and publishes via orphan release tags.

### Build

```sh
just build
```

Runs `pnpm install`, `pnpm tsc`, and `pnpm esbuild`.

### Key Details

- Detects runner OS (`linux`, `darwin`, `windows`) and arch (`amd64`, `arm64`)
- Tries `https://pazer.build/dl/{project}/{version}/{os}/{arch}` first (no auth needed for public projects)
- Falls back to `gh release download` if buildhost is unavailable or returns non-200
- GitHub fallback expects assets named `{name}_{os}_{arch}` (with `.exe` suffix on Windows)
- Installs to `~/.local/bin` and adds it to `PATH`
- `token` input is only required for the GitHub Releases fallback path

### Testing

No automated tests. Test by downloading a known release binary in a workflow.
