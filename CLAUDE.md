# Tag Runner

## Overview

Node.js action (TypeScript) that tags runner container images via the GitHub API and Docker buildx imagetools.

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

- Uses `@actions/github` octokit to find which branch has the SHA at HEAD
- Uses `docker buildx imagetools create` to tag images (no pull/push needed)
- Sanitizes branch names for Docker tag compatibility
- Triggers `flush-runners.yml` workflow dispatch on master updates
- Skips non-runner packages and cache tags

### Testing

No automated tests. Test by triggering a `registry_package` event in a test repository.
