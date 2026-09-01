# Sharing source between actions (`_shared/`)

Each action directory is its own package. Common code used to be **copied** into both actions that needed it. A `cmp` step in `release.yml` asserted that the copies stayed byte-identical.

That convention is gone. Copies drift the moment anything goes unchecked. `cache-cleanup` had quietly grown a third copy of `KEY_PREFIX` and `escapeRegExp`. A bug fixed in one copy is a bug that still ships from the other.

Common code now lives in `shared/<topic>/`. Each action imports it by relative path:

```ts
import {handoffKey} from '../../shared/cache-xfer/lib';
```

## What makes that work

The build keeps the shape of every other node action in this repo: `tsc`, then `esbuild`. TypeScript is compiled exactly **once**:

- **`tsc` is the only tool that ever reads TypeScript.** It type-checks and emits JavaScript. `rootDir` is the repo root and `outDir` is `.tsc-out/`. The sources of an action and the `shared/` sources it imports therefore land side by side at a deterministic path (`.tsc-out/<action>/src/index.js`).
- **`esbuild` bundles that JavaScript**, never TypeScript. It is a bundler here, not a second compiler. Nothing it consumes has types left in it, so the absence of type-checking in esbuild does not matter. A type error in action code or in shared code fails `just build` at the `tsc` step, and it never reaches esbuild.
- **`dist/index.js` stays self-contained.** The bundle inlines the shared modules. The orphan release tag therefore ships exactly what it always did. Nothing needs `shared/` at runtime. The build recipe deletes `.tsc-out/`, so it can never end up in a tag.
- **`shared/` has no `action.yml`.** The detect job in `release.yml` never treats it as an action and never publishes a tag for it. Type definitions come from whichever action is being built.

Do NOT "simplify" this into `tsc --noEmit` plus `esbuild src/index.ts`. That compiles the TypeScript twice, once for checking and once for output.

## Tests

Shared code keeps its tests next to it (`shared/cache-xfer/*.test.ts`). The per-action test matrix only globs `src/*.test.ts`. The `test-cache-xfer` job in `release.yml` therefore runs the shared tests once, with the toolchain of cache-download.

## Adding a new shared module

1. Put it in `shared/<topic>/`, tests included.
2. Import it by relative path from each action that needs it.
3. Add a step that runs its tests once where no existing job covers them. Shared tests have no automatic owner.
