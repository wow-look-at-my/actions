# Smart Cache

## Overview

Node.js action (TypeScript) that wraps `@actions/cache` with file change detection to avoid unnecessary cache saves.

## Structure

- `action.yml` — Action definition with `main` and `post` pointing to `dist/index.js`
- `src/index.ts` — TypeScript source (single file handles both main and post steps)
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

- Single entry point (`dist/index.js`) handles both main and post steps via `isPost` state
- Main step: restores cache, snapshots file mtimes, saves state for post step
- Post step: compares current mtimes against snapshot, only saves if changes detected
- Cache reservation conflicts (from parallel jobs) are caught and logged as info, not errors
- State is passed between main and post via `core.saveState`/`core.getState`

### Testing

No automated tests. Test by using the action in a workflow and checking that cache saves are skipped when nothing changed.
