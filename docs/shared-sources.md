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

The build is unchanged in shape from every other node action in this repo --
`tsc` then `esbuild` -- and TypeScript is compiled exactly **once**:

- **`tsc` is the only tool that ever reads TypeScript.** It type-checks and
  emits JavaScript. `rootDir` is the repo root and `outDir` is `.tsc-out/`, so
  an action's sources and the `shared/` sources it imports land side by side
  at a deterministic path (`.tsc-out/<action>/src/index.js`).
- **`esbuild` bundles that JavaScript**, never TypeScript. It is a bundler
  here, not a second compiler, so the fact that esbuild does not type-check is
  irrelevant -- nothing it consumes has types left in it. A type error, in
  action code or shared code, fails `just build` at the `tsc` step and never
  reaches esbuild.
- **`dist/index.js` stays self-contained.** The bundle inlines the shared
  modules, so the orphan release tag ships exactly what it always did; nothing
  needs `shared/` at runtime. `.tsc-out/` is deleted by the build recipe, so it
  can never end up in a tag.
- **`shared/` has no `action.yml`**, so `release.yml`'s detect job never treats
  it as an action and never publishes a tag for it. Type definitions come from
  whichever action is being built.

Do NOT "simplify" this into `tsc --noEmit` plus `esbuild src/index.ts`: that
compiles the TypeScript twice, once for checking and once for output.

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
