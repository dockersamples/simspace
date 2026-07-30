// Builds the lab catalog (labs.json) from the labs on disk, so nobody hand-writes
// or hand-maintains the catalog: each lab's card metadata comes straight from its
// own labspace.yaml (title/description + an optional `catalog:` block), giving a
// single source of truth and no drift.
//
// Shared by the Vite plugin (serves/emits labs.json for dev and build) and the
// validator (regenerates + checks it). Plain ESM + `yaml` so every consumer —
// vite.config, node scripts, esbuild-bundled TS — can import it.

import { parse } from "yaml";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_ICON = "science";

/**
 * Immediate subdirectories of `labsDir` that contain a `labspace.yaml`, sorted.
 * The directory name is the lab's id (and its URL segment + storage namespace).
 */
export function findLabDirs(labsDir) {
  if (!existsSync(labsDir) || !statSync(labsDir).isDirectory()) return [];
  return readdirSync(labsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(labsDir, name, "labspace.yaml")))
    .sort();
}

/**
 * Build the catalog object ({ labs: [...] }) from every lab under `labsDir`.
 * Throws if a lab's labspace.yaml doesn't parse. Ordering: an optional
 * `catalog.order` (ascending), then title.
 */
export function buildCatalog(labsDir) {
  const labs = [];
  for (const id of findLabDirs(labsDir)) {
    let doc;
    try {
      doc =
        parse(readFileSync(join(labsDir, id, "labspace.yaml"), "utf8")) ?? {};
    } catch (e) {
      throw new Error(`labs/${id}/labspace.yaml does not parse: ${e.message}`);
    }
    const cat = (doc && typeof doc === "object" && doc.catalog) || {};
    const track = (doc && typeof doc === "object" && doc.tracking) || null;
    labs.push({
      id,
      path: `labs/${id}/labspace.yaml`,
      // Card text defaults to the lab's own title/description; a `catalog:` block
      // may override either for the landing page without duplicating the rest.
      title: cat.title || doc.title || id,
      description: cat.description ?? doc.description ?? "",
      icon: cat.icon || DEFAULT_ICON,
      tags: Array.isArray(cat.tags) ? cat.tags : [],
      estimatedMinutes: cat.estimatedMinutes ?? null,
      order: typeof cat.order === "number" ? cat.order : null,
      // Public tracking coordinates (endpoint + bucket id) so the landing page
      // can show a cumulative "N completed" per lab and link to its dashboard.
      // Only the non-sensitive bits; omitted entirely when a lab opts out.
      tracking:
        track && track.endpoint
          ? { endpoint: track.endpoint, labId: track.labId || id }
          : null,
    });
  }
  labs.sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    return ao !== bo ? ao - bo : a.title.localeCompare(b.title);
  });
  // `order` is only a sort hint — drop it from the emitted catalog.
  return { labs: labs.map(({ order, ...entry }) => entry) };
}

/** Serialize the catalog as pretty JSON with a trailing newline. */
export function catalogJson(labsDir) {
  return JSON.stringify(buildCatalog(labsDir), null, 2) + "\n";
}
