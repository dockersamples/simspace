// Optional lab catalog. When a `labs.json` is deployed alongside the app, the
// engine presents a landing page listing every lab and lets the learner pick
// one. When it's ABSENT (HTTP 404 or empty), the app falls back to loading the
// single lab in `lab/` exactly as before — no catalog, no lab id in the URL.
//
// labs.json shape:
//   {
//     "labs": [
//       {
//         "id": "docker-tour",                 // stable id — keys saved state
//         "path": "labs/docker-tour/labspace.yaml",
//         "title": "A Tour of Docker",         // card title (falls back to id)
//         "description": "One-line summary.",  // card body (optional)
//         "icon": "sailing",                   // material-symbols name (optional)
//         "tags": ["docker", "beginner"],      // optional chips
//         "estimatedMinutes": 30               // optional "~30 min" hint
//       }
//     ]
//   }
//
// Paths resolve relative to the app's base URL (like labspace.yaml does), so a
// subpath deploy (e.g. GitHub Pages /sbxlab/) just works. Keep catalog labs
// under `labs/` so offline caching can recognize their content (see sw.js).

/** URL of the catalog file, overridable with `?catalog=<path>` (mirrors ?lab=). */
export function resolveCatalogUrl() {
  const override = new URLSearchParams(window.location.search).get("catalog");
  return new URL(override || "labs.json", document.baseURI).toString();
}

function normalize(lab) {
  return {
    id: lab.id,
    title: lab.title || lab.id,
    description: lab.description || "",
    icon: lab.icon || "science",
    tags: Array.isArray(lab.tags) ? lab.tags : [],
    estimatedMinutes: lab.estimatedMinutes ?? null,
    // Fully-resolved URL of this lab's labspace.yaml, ready to hand to the loader.
    labspaceUrl: new URL(lab.path, document.baseURI).toString(),
  };
}

/**
 * Loads the catalog. Returns an array of normalized lab entries, or `null` when
 * no usable catalog exists (missing file, parse error, or empty list) so the
 * caller can fall back to single-lab mode.
 */
export async function loadCatalog(catalogUrl = resolveCatalogUrl()) {
  try {
    const res = await fetch(catalogUrl);
    if (!res.ok) return null; // 404 -> fall back to the single lab in lab/
    const data = await res.json();
    const labs = Array.isArray(data?.labs) ? data.labs : [];
    const valid = labs.filter((l) => l && l.id && l.path).map(normalize);
    return valid.length ? valid : null;
  } catch {
    // Malformed JSON or a network error: treat as "no catalog" and fall back.
    return null;
  }
}
