// Client-side Labspace loader. Replaces the Go API: fetches a single
// labspace.yaml (plus the simulator spec, section markdown, and any seed files
// it references) as static assets and parses everything in the browser.
//
// labspace.yaml shape:
//   title: My Lab
//   description: One-line summary
//   simulator: simulator.yaml        # path to the scenario spec (required)
//   files:                           # optional seed for the virtual filesystem
//     app/server.js: "..."
//   sections:
//     - title: Introduction
//       contentPath: intro.md
//   variables: { key: value }
//   services:                        # optional external-URL tabs
//     - title: Docs
//       url: https://example.com
//   terminals:                       # optional multiple terminal tabs
//     - id: host                     # (defaults to a single "terminal" tab)
//       title: Host
//       icon: dns
//     - id: agent
//       title: Agent
//       icon: smart_toy
//
// All terminals share ONE simulator instance (state + filesystem), so a change
// made in one is visible in the others — like two shells on the same machine.
// Scenarios can scope themselves to a terminal with `when.terminal: <id>`.
//
// A SLIDE DECK is the same file with `kind: slides`, and differs in three ways:
//
//   kind: slides
//   simulator: ../containers-101/simulator.yaml   # OPTIONAL for a deck
//   slides:                                        # alias of `sections:`
//     - contentPath: 01-why-containers.md          # split into slides on `---`
//
// Everything else (title, variables, files, terminals, tracking) means exactly
// the same thing, which is why one loader serves both.

import { parse } from "yaml";
import { slugify } from "./slugify";
import { parseSlides } from "../deck/splitSlides";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  }
  return res.text();
}

/**
 * Loads and parses the labspace, returning a fully-resolved config. Section
 * markdown is kept raw (`contentRaw`); variable substitution happens at render
 * time so it reflects the current variable values.
 */
export async function loadLabspace(labUrl) {
  const raw = parse(await fetchText(labUrl));
  if (!raw || typeof raw !== "object") {
    throw new Error("labspace.yaml did not parse to an object");
  }

  const resolve = (relPath) => new URL(relPath, labUrl).toString();

  const labBaseUrl = new URL(".", labUrl).toString();

  // What this entry is. A deck reads the same as a lab apart from three things:
  // `slides:` reads better than `sections:` (they're the same list), `simulator:`
  // is optional (a deck without a live demo needs no scenarios), and each
  // section's markdown is split into slides on `---`.
  const kind = raw.kind === "slides" ? "slides" : "lab";

  const sectionDefs = Array.isArray(raw.slides)
    ? raw.slides
    : Array.isArray(raw.sections)
      ? raw.sections
      : [];
  const sectionContentUrls = sectionDefs.map((sec) =>
    sec.contentPath ? resolve(sec.contentPath) : null,
  );
  const sections = await Promise.all(
    sectionDefs.map(async (sec, i) => {
      const contentUrl = sectionContentUrls[i];
      // A deck's chapters are frequently untitled (the slides carry the
      // headings), so fall back to a positional id rather than the empty string
      // slugify would return.
      const id = slugify(sec.title) || `chapter-${i + 1}`;
      const baseUrl = contentUrl
        ? new URL(".", contentUrl).toString()
        : labBaseUrl;
      const contentRaw = contentUrl ? await fetchText(contentUrl) : "";
      return {
        id,
        title: sec.title,
        // Directory the section's markdown lives in. Relative asset paths in
        // that file (`images/diagram.png`, `../shared/logo.svg`, …) resolve
        // against this, so images load no matter how sections are nested.
        baseUrl,
        contentRaw,
        // For a deck, the chapter's markdown is further split into individual
        // slides on `---` (see deck/splitSlides.js). Labs get an empty list and
        // read `contentRaw` as one continuous page, exactly as before.
        slides:
          kind === "slides"
            ? parseSlides(contentRaw, { chapterId: id, baseUrl })
            : [],
        // Optional progress-tracking checkpoints for this section. A step's id
        // is referenced by a scenario's `completes:` in simulator.yaml; it
        // defaults to slugify(title) so authors can omit it. Absent → the
        // section declares no steps (progress tracking is fully opt-in).
        steps: (Array.isArray(sec.steps) ? sec.steps : []).map((step) => ({
          id: step.id || slugify(step.title || ""),
          title: step.title,
        })),
      };
    }),
  );

  const services = (Array.isArray(raw.services) ? raw.services : []).map(
    (svc) => ({
      id: svc.id || slugify(svc.title),
      title: svc.title,
      icon: svc.icon,
      url: svc.url,
    }),
  );

  // A lab is defined by its simulated commands, so a missing `simulator:` is a
  // hard error. A deck only needs one if some slide runs a live demo, so there it
  // is optional and the terminal layer simply has no simulator to offer.
  if (!raw.simulator && kind !== "slides") {
    throw new Error("labspace.yaml is missing a `simulator` path");
  }
  const simulatorSpec = raw.simulator
    ? await fetchText(resolve(raw.simulator))
    : null;

  // Terminals become tabs in the right-hand pane. They all share the single
  // simulator above, so commands run in any terminal act on the same state and
  // filesystem. Authors declare several (e.g. a host shell and an agent
  // session) so commands can target one via `terminal-id` in a code block and
  // scenarios can gate on `when.terminal`. With none declared, a single default
  // terminal is used.
  const terminalDefs =
    Array.isArray(raw.terminals) && raw.terminals.length
      ? raw.terminals
      : [{ id: "terminal", title: "Terminal", icon: "terminal" }];

  const terminals = terminalDefs.map((t, index) => ({
    id: t.id || slugify(t.title || "") || `terminal-${index}`,
    title: t.title || "Terminal",
    icon: t.icon || "terminal",
  }));

  return {
    // Directory the lab is served from (the parent of labspace.yaml). Used as
    // the fallback base for resolving relative asset paths; individual sections
    // carry their own `baseUrl` for markdown that lives in subdirectories.
    baseUrl: labBaseUrl,
    // All URLs fetched during load — used by the offline cache action to
    // pre-populate the service worker cache with all lab content.
    offlineUrls: [
      labUrl,
      // A deck may have no simulator at all — don't resolve a null path into a
      // bogus URL the service worker would then try to cache.
      ...(raw.simulator ? [resolve(raw.simulator)] : []),
      ...sectionContentUrls.filter(Boolean),
    ],
    // "lab" or "slides" — which view runs this entry. See EntryRoute.
    kind,
    // Deck presentation defaults. `theme` is the surface every slide starts from
    // and `brand` supplies the chrome (logo, eyebrow, source line) so an author
    // sets it once here rather than repeating it on every slide.
    theme: raw.theme || null,
    // `brand.logo` is lab-relative like every other path in this file, so a deck
    // carries its own brand assets and stays a self-contained, portable bundle.
    // Resolved to an absolute URL here so it also survives a subpath deploy.
    brand: resolveBrand(raw.brand, resolve),
    title: raw.title || "Labspace",
    subtitle: raw.description || "",
    // Optional lab version, used to namespace/invalidate stored progress when a
    // lab's steps change. Unversioned labs (no `version:`) leave this null.
    version: raw.version != null ? String(raw.version) : null,
    sections,
    services,
    variables: raw.variables || {},
    files: raw.files || {},
    terminals,
    // Optional feature flags (e.g. `features.ci` enables the mock CI tab). Kept
    // as-is so presentation code can read per-feature config (title, icon).
    features: raw.features || {},
    // The lab's raw tracking DIRECTIVE, resolved against the deployment default
    // (config.json) at runtime by the tracking layer:
    //   undefined → null → inherit the default (tracked when one is set)
    //   false            → explicit opt-out (no tracking for this lab)
    //   { ... }          → overrides merged over the default
    // `?? null` (not `|| null`) so an explicit `false` opt-out is preserved.
    tracking: raw.tracking ?? null,
    simulatorSpec,
  };
}

/**
 * Resolves a deck's `brand:` block, turning a lab-relative `logo` into an
 * absolute URL. Absolute paths and full URLs pass through untouched, so a deck can
 * point at a CDN or a shared asset outside its own directory if it wants to.
 */
function resolveBrand(brand, resolve) {
  if (!brand || typeof brand !== "object") return {};
  const logo = brand.logo;
  if (!logo || typeof logo !== "string") return { ...brand };
  const isAbsolute = /^([a-z]+:)?\/\//i.test(logo) || logo.startsWith("/");
  return { ...brand, logo: isAbsolute ? logo : resolve(logo) };
}
