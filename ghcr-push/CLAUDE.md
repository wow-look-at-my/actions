# GHCR Push

## Overview

Node.js action (TypeScript) that pushes a container image to GHCR and prunes old versions. Keeps the last N tagged versions and all untagged versions they reference (multi-arch sub-manifests, config blobs, layers).

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

- Logs in to GHCR via `docker login` with token piped to stdin
- Pushes image via `docker push`
- Uses GitHub Packages REST API to list/delete versions (handles both org and user packages)
- Uses `docker manifest inspect` to find digests referenced by kept versions
- Recursively inspects sub-manifests for multi-arch images
- If manifest inspection fails, conservatively skips untagged cleanup
- Individual deletion failures are logged as warnings, not fatal errors
- `push: false` skips the `docker push` step (useful when called only for pruning, e.g. from `go-packages`)
- `prune: false` enables dry-run mode (logs what would be deleted)

### Testing

No automated tests. Test by pushing an image and verifying version cleanup in a workflow.
