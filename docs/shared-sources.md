# Sharing source between actions (`shared/`)

Each action directory is its own package, which used to mean code common to
two actions was **copied** into both, with a `cmp` step in `release.yml`
asserting the copies stayed byte-identical. That convention is gone: copies
drift the moment anything is not checked (`cache-cleanup` had quietly grown
its own third copy of `KEY_PREFIX` and `escapeRegExp`), and a bug fixed in one
copy is a bug still shipping from the other.

Common code now lives in `shared/<topic>/` and is imported by relative path:

```ts
import {handoffKey} from '../../shared/cache-xfer/lib';
```

## What makes that work

- **esbuild bundles from the TypeScript entrypoint** (`pnpm esbuild src/index.ts
  --bundle`), so imports that leave the action directory resolve like any
  other. `tsc` runs as `--noEmit` -- purely a typecheck -- and each action's
  `tsconfig.json` adds `../shared/**/*` to `include`.
- **`dist/index.js` stays self-contained.** The bundle inlines the shared
  modules, so the orphan release tag ships exactly what it always did; nothing
  needs `shared/` at runtime.
- **`shared/` has no `package.json`**, so `release.yml`'s detect job never
  treats it as an action and never publishes a tag for it. Type definitions
  come from whichever action is being built.

## Tests

Shared code keeps its tests next to it (`shared/cache-xfer/*.test.ts`). The
per-action test matrix only globs `src/*.test.ts`, so `release.yml`'s
`test-cache-xfer` job runs the shared tests once, using cache-download's
toolchain.

## Adding a new shared module

1. Put it in `shared/<topic>/`, tests included.
2. Import it by relative path from each action that needs it.
3. If it is not covered by an existing job, add a step that runs its tests
   once -- shared tests have no automatic owner.
