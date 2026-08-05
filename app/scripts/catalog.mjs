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

/** Entry kinds the catalog understands. `lab` is the default when `kind:` is absent. */
export const KINDS = ["lab", "slides"];

/** Default card icon per kind, so a deck reads as a deck without configuration. */
export const DEFAULT_ICONS = { lab: "science", slides: "slideshow" };

export const DEFAULT_ICON = DEFAULT_ICONS.lab;

/**
 * The entry's kind, defaulting to "lab" so every pre-existing labspace.yaml is
 * unchanged. An unrecognized value falls back to "lab" here and is reported as
 * an error by validate-lab — a typo shouldn't make an entry vanish from the
 * catalog with no explanation.
 */
export function entryKind(doc) {
  const raw = doc && typeof doc === "object" ? doc.kind : undefined;
  return typeof raw === "string" && KINDS.includes(raw) ? raw : "lab";
}

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
    const kind = entryKind(doc);
    labs.push({
      id,
      path: `labs/${id}/labspace.yaml`,
      // What this entry IS, which decides how the app opens it: a lab runs in
      // the instructions + terminal split, a deck runs as slides. The card looks
      // the same either way apart from its default icon.
      kind,
      // Card text defaults to the lab's own title/description; a `catalog:` block
      // may override either for the landing page without duplicating the rest.
      title: cat.title || doc.title || id,
      description: cat.description ?? doc.description ?? "",
      icon: cat.icon || DEFAULT_ICONS[kind],
      tags: Array.isArray(cat.tags) ? cat.tags : [],
      estimatedMinutes: cat.estimatedMinutes ?? null,
      order: typeof cat.order === "number" ? cat.order : null,
      // The lab's raw tracking DIRECTIVE, not a resolved endpoint: `false`
      // (opt-out), an overrides object, or null (inherit the deployment default
      // from config.json). The app resolves it against that default at runtime,
      // so the landing page can still show a per-lab "Completed by N" and link
      // to the dashboard without the endpoint being duplicated into every lab.
      tracking:
        doc && typeof doc === "object" && "tracking" in doc
          ? doc.tracking
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
