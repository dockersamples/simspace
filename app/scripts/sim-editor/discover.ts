// Finding the simulator specs in a repo, and the labspace context each one
// needs to be checked properly.
//
// A `simulator.yaml` on its own can't tell you whether `when.terminal: sandbox`
// or `completes: run-container` is a typo — the terminal ids and the step
// catalog live in the `labspace.yaml` that references it. Several entries can
// also share one spec (a slide deck reusing its lab's scenarios), in which case
// those ids belong to whichever entry is running and cross-checking them would
// be wrong. Both facts come from walking the labs tree, which is what this
// does.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface SpecEntry {
  /** Absolute path to the simulator.yaml. */
  path: string;
  /** Path relative to the working directory, for display. */
  relPath: string;
  /** Entry ids of the labspaces that reference this spec. */
  labIds: string[];
  /** Display title of the first referencing entry. */
  title: string;
  /** True when more than one entry shares this spec. */
  shared: boolean;
  /** Terminal ids declared across the referencing entries. */
  terminalIds: string[];
  /** Step ids cataloged by the referencing entries' sections. */
  stepIds: string[];
  /** The virtual filesystem seed, so `ls`/`cat` behave as they do in the lab. */
  files: Record<string, string>;
}

/**
 * discover returns the specs under `target`, which may be a labs directory, a
 * single lab directory, or a simulator.yaml itself. A spec with no labspace
 * pointing at it is still returned — the editor works on a bare file, it just
 * can't cross-check terminal or step ids.
 */
export function discover(target: string, cwd = process.cwd()): SpecEntry[] {
  const abs = resolve(cwd, target);
  if (!existsSync(abs)) {
    throw new Error(`no such file or directory: ${target}`);
  }

  if (statSync(abs).isFile()) {
    const entries = collect(dirname(dirname(abs)), cwd);
    const hit = entries.find((e) => e.path === abs);
    return [hit ?? bare(abs, cwd)];
  }
  const found = collect(abs, cwd);
  return found.length ? found : [];
}

/** collect walks a labs tree and groups labspaces by the spec they reference. */
function collect(labsDir: string, cwd: string): SpecEntry[] {
  const byPath = new Map<string, SpecEntry>();
  if (!existsSync(labsDir) || !statSync(labsDir).isDirectory()) return [];

  for (const name of readdirSync(labsDir).sort()) {
    const dir = join(labsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const labspacePath = join(dir, "labspace.yaml");
    if (!existsSync(labspacePath)) continue;

    let labspace: Record<string, unknown>;
    try {
      labspace = (parseYaml(readFileSync(labspacePath, "utf8")) ??
        {}) as Record<string, unknown>;
    } catch {
      continue; // a labspace that doesn't parse is validate-lab's problem
    }

    const simulator = labspace.simulator;
    if (typeof simulator !== "string" || !simulator) continue;
    const specPath = resolve(dir, simulator);
    if (!existsSync(specPath)) continue;

    const entry = byPath.get(specPath) ?? bare(specPath, cwd);
    entry.labIds.push(name);
    entry.shared = entry.labIds.length > 1;
    if (entry.labIds.length === 1) {
      entry.title = String(labspace.title ?? name);
    }
    for (const id of terminalIds(labspace)) {
      if (!entry.terminalIds.includes(id)) entry.terminalIds.push(id);
    }
    for (const id of stepIds(labspace)) {
      if (!entry.stepIds.includes(id)) entry.stepIds.push(id);
    }
    Object.assign(entry.files, seedFiles(labspace));
    byPath.set(specPath, entry);
  }
  return [...byPath.values()];
}

function bare(path: string, cwd: string): SpecEntry {
  return {
    path,
    relPath: relative(cwd, path) || basename(path),
    labIds: [],
    title: basename(dirname(path)),
    shared: false,
    terminalIds: [],
    stepIds: [],
    files: {},
  };
}

/**
 * terminalIds mirrors the labspace loader's defaulting: an entry may name a
 * terminal by title alone, and a labspace with no `terminals:` still has the
 * engine's implicit one.
 */
function terminalIds(labspace: Record<string, unknown>): string[] {
  const terminals = (labspace.terminals ?? []) as {
    id?: string;
    title?: string;
  }[];
  if (!Array.isArray(terminals) || terminals.length === 0) return ["terminal"];
  return terminals.map(
    (t, i) => t.id ?? (t.title ? slugify(t.title) : `terminal-${i}`),
  );
}

/**
 * stepIds collects the section step catalog, defaulting a step's id to its
 * slugified title exactly as the labspace loader does — an author may write
 * `- title: "Run a container"` with no id, and `completes: run-a-container`
 * against it is then correct, not a dangling reference.
 */
function stepIds(labspace: Record<string, unknown>): string[] {
  const sections = (labspace.sections ?? labspace.slides ?? []) as {
    steps?: { id?: string; title?: string }[];
  }[];
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((s) =>
    (Array.isArray(s?.steps) ? s.steps : [])
      .map((step) => step?.id || slugify(step?.title ?? ""))
      .filter(Boolean),
  );
}

function seedFiles(labspace: Record<string, unknown>): Record<string, string> {
  const files = labspace.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = typeof content === "string" ? content : String(content ?? "");
  }
  return out;
}

/**
 * slugify matches `packages/labspace/src/labspace/slugify.js`, so the ids this
 * defaults are the ids the runtime will use. Copying five lines beats importing
 * the lab runtime into a dev tool, but they have to stay identical.
 */
function slugify(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}
