// Bundles the TypeScript service to a single CommonJS file with esbuild, the
// same toolchain the app uses for its Node scripts (no tsx/ts-node). Storage is
// Node's built-in `node:sqlite`, so there are no runtime dependencies and
// nothing to mark external — dist/server.cjs is the whole service.

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/server.cjs",
  logLevel: "info",
});
