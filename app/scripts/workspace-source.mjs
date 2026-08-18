// Where the workspace packages' entry points live IN SOURCE.
//
// The packages publish BUILT output, so their `exports` point at `dist/`. Inside
// this repo we deliberately consume their source instead: `npm run dev`
// hot-reloads a change made inside a package, and nothing here can accidentally
// run against a stale `dist/`. `dist/` exists for consumers outside this repo
// (see build-package.mjs).
//
// ONE map, imported by everything that resolves these names — vite.config.js,
// vitest.config.js, and run-ts.mjs. It used to be copied into the two Vite
// configs and simply missing from run-ts.mjs, so `npm run validate-lab` resolved
// through `exports` to a `dist/` that only existed on machines where someone had
// run a package build. It passed locally and for anyone with an older image, and
// broke every downstream lab repo's CI:
//
//   Could not resolve "@dockersamples/simspace-simulator"
//   The module "./dist/index.js" was not found on the file system
//
// Anything new that resolves these package names belongs here too.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Ordered longest-key-first: Vite matches aliases by prefix, so a broader key
// listed first would rewrite "…/react/styles.css" into "…/react/index.ts/styles.css".
export const workspaceSource = {
  "@dockersamples/simspace-labspace/loader": resolve(
    appDir,
    "packages/labspace/src/loader.js",
  ),
  "@dockersamples/simspace-labspace": resolve(
    appDir,
    "packages/labspace/src/index.js",
  ),
  "@dockersamples/simspace-simulator/react/styles.css": resolve(
    appDir,
    "packages/simulator/src/react/MockTerminal.css",
  ),
  "@dockersamples/simspace-simulator/react": resolve(
    appDir,
    "packages/simulator/src/react/index.ts",
  ),
  "@dockersamples/simspace-simulator": resolve(
    appDir,
    "packages/simulator/src/index.ts",
  ),
};
