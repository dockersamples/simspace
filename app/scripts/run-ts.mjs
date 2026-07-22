// Bundles a TypeScript entry (with its engine imports) to CommonJS via esbuild
// and runs it in-process. This lets the repo's Node scripts import the engine
// directly without a separate build step or a `tsx`/`ts-node` dependency —
// esbuild already ships as a dev dependency.
//
//   node scripts/run-ts.mjs scripts/validate-lab.ts <lab-dir>
//
// CommonJS output (not ESM) is deliberate: the `yaml` dependency the engine
// pulls in uses a dynamic `require` that breaks under esbuild's ESM output.

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [, , entry, ...rest] = process.argv;
if (!entry) {
  console.error("usage: node scripts/run-ts.mjs <entry.ts> [args...]");
  process.exit(2);
}

const result = await build({
  entryPoints: [resolve(entry)],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "warning",
});

const dir = mkdtempSync(join(tmpdir(), "labspace-run-"));
const out = join(dir, "bundle.cjs");
writeFileSync(out, result.outputFiles[0].text);

// Re-point argv so the entry sees [node, <entry>, ...passthrough args].
process.argv = [process.argv[0], resolve(entry), ...rest];
await import(pathToFileURL(out).href);
