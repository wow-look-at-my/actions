# Sharing source between actions

Each action directory is its own package. Common code lives here instead, and each action imports it by relative path. There is one copy of it, so a bug fixed in it is fixed everywhere it ships.

## What makes that work

The build keeps the shape of every other node action in this repo: `tsc`, then `esbuild`. TypeScript is compiled exactly **once**:

- **`tsc` is the only tool that ever reads TypeScript.** It type-checks and emits JavaScript. `rootDir` is the repo root. The sources of an action and the shared sources it imports therefore land side by side at a deterministic path.
- **`esbuild` bundles that JavaScript**, never TypeScript. It is a bundler here, not a second compiler. Nothing it consumes has types left in it, so the absence of type-checking in esbuild does not matter. A type error in action code or in shared code fails `just build` at the `tsc` step, and it never reaches esbuild.
- **The bundle stays self-contained.** It inlines the shared modules, so the orphan release tag ships exactly what it always did and nothing needs this directory at runtime. The build recipe deletes the intermediate output, so it can never end up in a tag.
- **There is no `action.yml` here.** The detect job in `release.yml` never treats this directory as an action and never publishes a tag for it. Type definitions come from whichever action is being built.

Do NOT "simplify" this into `tsc --noEmit` plus `esbuild` over the TypeScript. That compiles the TypeScript twice, once for checking and once for output.

## Tests

Shared code keeps its tests next to it. The per-action test matrix only globs the `src/` of one action. `release.yml` therefore runs the shared tests in a job of their own, with the toolchain of an action that imports them.

## Adding a new shared module

1. Put it in a directory here, tests included.
2. Import it by relative path from each action that needs it.
3. Add a step that runs its tests once where no existing job covers them. Shared tests have no automatic owner.
