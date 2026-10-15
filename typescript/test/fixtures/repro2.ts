// repro2.ts -- dogfood test for the typescript action, run in CI via: uses: wow-look-at-my/actions@typescript#latest with: file.

export const VERSION = "1.0.0";

import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
return pkg.version; // top-level return, alongside a top-level import/export
