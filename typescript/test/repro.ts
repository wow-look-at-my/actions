// repro.ts -- dogfood test for the typescript action, run in CI via: uses: wow-look-at-my/actions@typescript#latest with: file.

import { setTimeout as sleep } from "node:timers/promises"; // top-level import

// Injected globals (ambiently declared in globals.d.ts) must still resolve:
core.info(`workspace = ${path.join(env.GITHUB_WORKSPACE ?? ".", "package.json")}`);

await sleep(10); // top-level await (must keep working)

const res = await fetch("https://api.github.com/zen"); // global fetch from @types/node
core.info(`zen: ${(await res.text()).trim()}`);
