// Rebuilds src/styles/material-symbols.woff2 from the upstream Material Symbols
// variable font.
//
//   node packages/labspace/scripts/instance-icon-font.mjs <upstream.woff2>
//
// WHY THIS EXISTS
//
// Upstream ships a variable font with four axes (FILL, wght, GRAD, opsz) and
// ~3,400 icons: 3.5 MB. The runtime is embedded in other people's pages, so that
// is 3.5 MB charged to a host's page weight for a handful of glyphs.
//
// The obvious fix — subset to the icons we use — does NOT work here, and it is
// worth writing down why so nobody spends an afternoon rediscovering it.
// Material Symbols is a LIGATURE font: `check_circle` is drawn by substituting
// the letters c,h,e,c,k,_,c,i,r,c,l,e. Subsetting by that text keeps the letter
// glyphs and the GSUB rules, whose closure reaches essentially every icon in the
// font. Measured: subsetting to 40 icons took 3.52 MB to 3.27 MB — 7%.
//
// There is a second reason not to subset by icon anyway. `icon:` in
// labspace.yaml is a free-form Material Symbols name (spec/labspace.md), so an
// author may name any of the ~3,400 at any time. A subset would turn a valid lab
// into blank squares, with nothing to point at.
//
// What DOES work is instancing: pinning the axes nobody varies. The runtime
// varies exactly one — FILL, for the filled check-mark on a completed section
// (WorkshopNav.scss, SectionMilestones.scss) — and leaves wght/GRAD/opsz at
// their defaults forever. Pinning those three keeps every icon and every
// variation the UI actually uses:
//
//   as shipped (4 axes, 3,400 icons)   3.52 MB
//   keep FILL, pin wght/GRAD/opsz        299 KB   ← what this produces, -92%
//   pin all four axes                    249 KB   (loses the filled check)
//
// Upstream source:
// https://github.com/google/material-design-icons/raw/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.woff2

import subsetFont from "subset-font";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error(
    "usage: node instance-icon-font.mjs <MaterialSymbolsOutlined[...].woff2>",
  );
  process.exit(1);
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles/material-symbols.woff2",
);

// Every character an icon ligature can be spelled with. Keeping all of them is
// the point: any icon name an author writes must still resolve.
const LIGATURE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_ ";

const input = readFileSync(source);
const result = await subsetFont(input, LIGATURE_CHARS, {
  targetFormat: "woff2",
  // FILL is deliberately absent — it stays a live axis.
  variationAxes: { wght: 400, GRAD: 0, opsz: 24 },
});

writeFileSync(out, result);
const mb = (b) => (b.length / 1048576).toFixed(2);
console.log(
  `${mb(input)} MB -> ${mb(result)} MB (${Math.round((1 - result.length / input.length) * 100)}% smaller)`,
);
console.log(`wrote ${out}`);
