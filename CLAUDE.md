# Download Release Binary

## Overview

Node.js action (TypeScript) that downloads platform-specific binaries from GitHub releases.

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
- Expects assets named `{name}_{os}_{arch}` (with `.exe` suffix on Windows)
- Uses `gh release download` for the actual download
- Strips platform suffix when renaming (e.g., `mytool_linux_amd64` becomes `mytool`)
- Installs to `~/.local/bin` and adds it to `PATH`

### Testing

No automated tests. Test by downloading a known release binary in a workflow.
