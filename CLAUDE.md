# Cache Size

## Overview

Node.js action (TypeScript) that reports disk usage breakdown of cached directories with special Go build cache handling.

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

- Auto-detects Go build caches (`go-build` in path) and breaks down by module name instead of hex shards
- Outputs both human-readable table (in logs) and machine-readable JSON (`breakdown` output)
- `depth` input controls subdirectory expansion for non-Go caches
- Go cache module detection reads the `-d` action file inside each shard directory

### Testing

No automated tests. Test by running in a workflow with cached Go build directories.
