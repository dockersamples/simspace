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

import { parse } from "yaml";
import { slugify } from "./slugify";

/**
 * Resolves the URL of the labspace.yaml to load. Defaults to `lab/labspace.yaml`
 * (the lab lives in its own directory so it can be mounted/replaced as a single
 * unit without clobbering the app's own assets), overridable with a `?lab=<path>`
 * query parameter so one build can host several labs.
 */
export function resolveLabUrl() {
  const override = new URLSearchParams(window.location.search).get("lab");
  return new URL(override || "lab/labspace.yaml", document.baseURI).toString();
}

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
export async function loadLabspace(labUrl = resolveLabUrl()) {
  const raw = parse(await fetchText(labUrl));
  if (!raw || typeof raw !== "object") {
    throw new Error("labspace.yaml did not parse to an object");
  }

  const resolve = (relPath) => new URL(relPath, labUrl).toString();

  const labBaseUrl = new URL(".", labUrl).toString();

  const sectionDefs = Array.isArray(raw.sections) ? raw.sections : [];
  const sectionContentUrls = sectionDefs.map((sec) =>
    sec.contentPath ? resolve(sec.contentPath) : null,
  );
  const sections = await Promise.all(
    sectionDefs.map(async (sec, i) => {
      const contentUrl = sectionContentUrls[i];
      return {
        id: slugify(sec.title),
        title: sec.title,
        // Directory the section's markdown lives in. Relative asset paths in
        // that file (`images/diagram.png`, `../shared/logo.svg`, …) resolve
        // against this, so images load no matter how sections are nested.
        baseUrl: contentUrl ? new URL(".", contentUrl).toString() : labBaseUrl,
        contentRaw: contentUrl ? await fetchText(contentUrl) : "",
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

  if (!raw.simulator) {
    throw new Error("labspace.yaml is missing a `simulator` path");
  }
  const simulatorSpec = await fetchText(resolve(raw.simulator));

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
      resolve(raw.simulator),
      ...sectionContentUrls.filter(Boolean),
    ],
    title: raw.title || "Labspace",
    subtitle: raw.description || "",
    sections,
    services,
    variables: raw.variables || {},
    files: raw.files || {},
    terminals,
    // Optional feature flags (e.g. `features.ci` enables the mock CI tab). Kept
    // as-is so presentation code can read per-feature config (title, icon).
    features: raw.features || {},
    simulatorSpec,
  };
}
