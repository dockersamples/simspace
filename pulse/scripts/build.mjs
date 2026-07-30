// Bundles the TypeScript service to a single CommonJS file with esbuild, the
// same toolchain the app uses for its Node scripts (no tsx/ts-node). CommonJS
// output keeps interop with the native `better-sqlite3` module simple; that
// module is marked external so its prebuilt binary loads from node_modules at
// runtime instead of being (impossibly) bundled.

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/server.cjs",
  external: ["better-sqlite3"],
  logLevel: "info",
});
