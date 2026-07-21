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

import { parse } from "yaml";
import { slugify } from "./slugify";

/**
 * Resolves the URL of the labspace.yaml to load. Defaults to `labspace.yaml`
 * next to the app, overridable with a `?lab=<path>` query parameter so one
 * build can host several labs.
 */
export function resolveLabUrl() {
  const override = new URLSearchParams(window.location.search).get("lab");
  return new URL(override || "labspace.yaml", document.baseURI).toString();
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

  const sectionDefs = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = await Promise.all(
    sectionDefs.map(async (sec) => ({
      id: slugify(sec.title),
      title: sec.title,
      contentRaw: sec.contentPath ? await fetchText(resolve(sec.contentPath)) : "",
    })),
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

  return {
    title: raw.title || "Labspace",
    subtitle: raw.description || "",
    sections,
    services,
    variables: raw.variables || {},
    files: raw.files || {},
    simulatorSpec,
  };
}
