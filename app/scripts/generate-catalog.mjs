// Writes labs.json from a labs/ directory. Used where there's no Vite (CI /
// Docker build) to produce the catalog before serving the static files.
//
//   node scripts/generate-catalog.mjs <labs-dir> <out-file>
//   npm run generate-catalog -- public/labs public/labs.json   (the defaults)
//
// For dev/build of the app itself the Vite plugin generates it instead, and the
// validator regenerates it too — all three share scripts/catalog.mjs, so the
// output is identical no matter which produced it.

import { writeFileSync } from "node:fs";
import { catalogJson } from "./catalog.mjs";

const labsDir = process.argv[2] ?? "public/labs";
const outFile = process.argv[3] ?? "public/labs.json";

try {
  writeFileSync(outFile, catalogJson(labsDir));
  console.log(`Wrote ${outFile} from ${labsDir}`);
} catch (e) {
  console.error(`✗ Failed to generate ${outFile}: ${e.message}`);
  process.exit(1);
}
