// validate-lab: static checks for a Labspace lab directory.
//
//   npm run validate-lab -- <lab-dir>      (default: public/lab)
//
// It parses a lab's labspace.yaml + simulator.yaml with the SAME engine parser
// the app uses, then reports authoring mistakes without anyone writing
// assertions. Checks are split into two severities:
//
//   ERROR   (exit 1) — the lab is broken: won't parse, a reference dangles, a
//                      template placeholder has no capture, or the markdown
//                      tells the learner to run a command no scenario, built-in,
//                      or agent prompt can handle.
//   WARNING (exit 0) — likely a mistake worth a look: a :filelink to a file the
//                      lab never provides, a {{ state.x }} nothing writes, a
//                      Run button on a non-shell block, a duplicate id.
//
// It intentionally does NOT simulate a full playthrough (which would need to
// know when prose tells the learner to flip a Settings toggle). Reachability is
// checked by command-prefix existence, which has no state false-positives.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseManifest,
  checkSchemaVersion,
  resolvePace,
  tokenize,
  Lab,
  Scenario,
  StateValue,
} from "../src/engine/index.ts";

// ── Reporting ─────────────────────────────────────────────────────────────────

interface Finding {
  where: string;
  message: string;
}
const errors: Finding[] = [];
const warnings: Finding[] = [];
const err = (where: string, message: string) => errors.push({ where, message });
const warn = (where: string, message: string) =>
  warnings.push({ where, message });

// Collected during the section + scenario passes, consumed by later checks.
const fileLinks: { path: string; section: string }[] = [];
const stateRefs: { path: string; at: string }[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

const BUILTINS = ["ls", "cat"];
const SHELL_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "",
  "text",
]);
const ARG_TMPL = /\{\{\s*args\.([A-Za-z0-9_.]+)\s*\}\}/g;
const STATE_TMPL = /\{\{\s*state\.([A-Za-z0-9_.]+)\s*\}\}/g;

/** Normalize an arg matcher name to the key templates use (dashes stripped). */
function captureKey(name: string): string {
  return /^\d+$/.test(name) ? name : name.replace(/^-+/, "");
}

/** Flatten a state tree into the set of dot-paths (leaves and intermediates). */
function flattenPaths(
  obj: StateValue | undefined,
  prefix = "",
  out = new Set<string>(),
): Set<string> {
  if (prefix) out.add(prefix);
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const k of Object.keys(obj)) {
      flattenPaths(
        (obj as Record<string, StateValue>)[k],
        prefix ? `${prefix}.${k}` : k,
        out,
      );
    }
  }
  return out;
}

/** Apply $$var$$ substitution the way the renderer does (unset → bare name). */
function substituteVars(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\$\$\s*([A-Za-z0-9_]+)\s*\$\$/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? name : String(v);
  });
}

interface Fence {
  lang: string;
  meta: string[];
  content: string;
  section: string;
  index: number; // fence ordinal within the section
}

/** Extract fenced code blocks from markdown, mirroring codeIndexer meta parsing. */
function extractFences(md: string, section: string): Fence[] {
  const lines = md.split("\n");
  const fences: Fence[] = [];
  let i = 0;
  let ordinal = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^```(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const info = m[1].trim().split(/\s+/).filter(Boolean);
    const lang = info[0] ?? "";
    const meta = info.slice(1);
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    i++; // consume closing fence
    fences.push({
      lang,
      meta,
      content: body.join("\n"),
      section,
      index: ordinal++,
    });
  }
  return fences;
}

function metaValue(meta: string[], key: string): string | undefined {
  const hit = meta.find((m) => m === key || m.startsWith(`${key}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "";
}

// ── Load ──────────────────────────────────────────────────────────────────────

const labArg = process.argv[2] ?? "public/lab";
const labDir = resolve(labArg);
if (!existsSync(labDir) || !statSync(labDir).isDirectory()) {
  console.error(`✗ lab directory not found: ${labDir}`);
  process.exit(2);
}

const labspacePath = join(labDir, "labspace.yaml");
if (!existsSync(labspacePath)) {
  console.error(`✗ no labspace.yaml in ${labDir}`);
  process.exit(2);
}

let labspace: Record<string, unknown>;
try {
  labspace = parseYaml(readFileSync(labspacePath, "utf8")) ?? {};
} catch (e) {
  console.error(`✗ labspace.yaml does not parse: ${(e as Error).message}`);
  process.exit(1);
}
if (typeof labspace !== "object" || labspace === null) {
  console.error("✗ labspace.yaml must be a mapping");
  process.exit(1);
}

const simulatorRel = labspace.simulator as string | undefined;
if (!simulatorRel) {
  err("labspace.yaml", "missing required `simulator:` field");
}

// Parse the simulator with the real engine parser so manifest errors surface.
let lab: Lab | undefined;
if (simulatorRel) {
  const simPath = join(dirname(labspacePath), simulatorRel);
  if (!existsSync(simPath)) {
    err("labspace.yaml", `simulator file not found: ${simulatorRel}`);
  } else {
    try {
      lab = parseManifest(readFileSync(simPath, "utf8"));
      checkSchemaVersion(lab.version);
    } catch (e) {
      err(simulatorRel, `does not parse: ${(e as Error).message}`);
    }
  }
}

const variables = (labspace.variables as Record<string, unknown>) ?? {};
const seedFiles = (labspace.files as Record<string, string>) ?? {};
const terminals =
  (labspace.terminals as { id?: string; title?: string }[]) ?? [];
const services = (labspace.services as { id?: string; title?: string }[]) ?? [];
const sections =
  (labspace.sections as { title?: string; contentPath?: string }[]) ?? [];

// slugify mirrors the labspace loader so terminal/service default ids match.
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

const terminalIds = new Set(
  terminals.map(
    (t, i) => t.id ?? (t.title ? slugify(t.title) : `terminal-${i}`),
  ),
);
if (terminals.length === 0) terminalIds.add("terminal"); // engine default

// ── Duplicate-id checks (WARNING) ──────────────────────────────────────────────

function reportDupes(ids: (string | undefined)[], kind: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) warn("labspace.yaml", `duplicate ${kind} id "${id}"`);
    seen.add(id);
  }
}
reportDupes(
  terminals.map(
    (t, i) => t.id ?? (t.title ? slugify(t.title) : `terminal-${i}`),
  ),
  "terminal",
);
reportDupes(
  services.map((s, i) => s.id ?? (s.title ? slugify(s.title) : `service-${i}`)),
  "service",
);

// ── Section files (ERROR) ──────────────────────────────────────────────────────

const fences: Fence[] = [];
for (const [i, s] of sections.entries()) {
  const label = s.title ?? `section #${i}`;
  if (!s.contentPath) continue;
  const p = join(dirname(labspacePath), s.contentPath);
  if (!existsSync(p)) {
    err(
      "labspace.yaml",
      `section "${label}" contentPath not found: ${s.contentPath}`,
    );
    continue;
  }
  const raw = readFileSync(p, "utf8");
  fences.push(...extractFences(raw, label));

  // :filelink paths referenced in prose.
  for (const fm of raw.matchAll(
    /:filelink\[[^\]]*\]\{[^}]*path="([^"]+)"[^}]*\}/g,
  )) {
    fileLinks.push({ path: fm[1], section: label });
  }
}

// ── Cross-file reference checks against the parsed simulator (ERROR) ────────────

const commandPrefixes: string[][] = [];
const agentScenarios: Scenario[] = [];
const writtenStatePaths = new Set<string>();

if (lab) {
  // Seed + control-written + scenario-written state paths (for {{ state.x }}).
  flattenPaths(lab.state, "", writtenStatePaths);
  for (const c of lab.controls ?? []) writtenStatePaths.add(c.state);

  const workflowIds = new Map(
    (lab.workflows ?? []).map((w) => [w.id, new Set(w.steps.map((s) => s.id))]),
  );

  // Valid names an output `delay` may reference (built-in profiles + settings.pace).
  const paceNames = new Set(Object.keys(resolvePace(lab.settings)));

  // A step's `requires` names a state path that decides its pass/fail — flag it
  // like a {{ state.x }} reference if nothing seeds or writes it.
  for (const w of lab.workflows ?? []) {
    for (const s of w.steps) {
      if (s.requires) {
        stateRefs.push({
          path: s.requires,
          at: `workflow "${w.id}" step "${s.id}" requires`,
        });
      }
    }
  }

  for (const sc of lab.scenarios) {
    const at = `scenario "${sc.id}"`;

    // when.terminal must be a declared terminal.
    if (sc.when.terminal && !terminalIds.has(sc.when.terminal)) {
      err(
        at,
        `when.terminal "${sc.when.terminal}" is not a declared terminal id`,
      );
    }

    // Collect command prefixes / agent scenarios for reachability.
    if (sc.when.agent) agentScenarios.push(sc);
    else if (sc.when.command) commandPrefixes.push(sc.when.command);

    // Record state writers.
    for (const key of Object.keys(sc.then.state ?? {})) {
      writtenStatePaths.add(key.replace(/\+=$/, "").trim());
    }

    // then.ci references.
    const ci = sc.then.ci;
    if (ci) {
      const steps = workflowIds.get(ci.workflow);
      if (!steps) {
        err(
          at,
          `then.ci.workflow "${ci.workflow}" is not in the workflows catalog`,
        );
      } else {
        if (ci.failedStep && !steps.has(ci.failedStep)) {
          err(
            at,
            `then.ci.failedStep "${ci.failedStep}" is not a step of "${ci.workflow}"`,
          );
        }
        for (const ov of ci.steps ?? []) {
          if (!steps.has(ov.id)) {
            err(
              at,
              `then.ci.steps id "${ov.id}" is not a step of "${ci.workflow}"`,
            );
          }
        }
      }
    }

    // Output pacing: a `delay` is either a non-negative number or the name of a
    // known pace profile. Catch typo'd profile names and bad values early.
    for (const stream of ["output", "stderr"] as const) {
      for (const [i, entry] of (sc.then[stream] ?? []).entries()) {
        if (typeof entry === "string" || entry.delay === undefined) continue;
        const delay = entry.delay;
        if (typeof delay === "number") {
          if (delay < 0)
            err(at, `then.${stream}[${i}].delay is negative (${delay})`);
        } else if (!paceNames.has(delay)) {
          err(
            at,
            `then.${stream}[${i}].delay "${delay}" is not a known pace profile (add it under settings.pace)`,
          );
        }
      }
    }

    // Template capture checks: every {{ args.X }} must be captured by when.args.
    const captures = new Set<string>();
    for (const [name, m] of Object.entries(sc.when.args ?? {})) {
      if (m.kind === "equals" || m.kind === "any" || m.kind === "oneOf") {
        captures.add(captureKey(name));
      }
    }
    for (const { text, field } of thenStrings(sc)) {
      for (const tm of text.matchAll(ARG_TMPL)) {
        if (!captures.has(tm[1])) {
          err(
            at,
            `${field} references {{ args.${tm[1]} }} but no matching capture in when.args`,
          );
        }
      }
      for (const sm of text.matchAll(STATE_TMPL)) {
        stateRefs.push({ path: sm[1], at: `${at} ${field}` });
      }
    }
  }
}

/** Yield every templatable string in a scenario's `then`, tagged with a field name. */
function* thenStrings(
  sc: Scenario,
): Generator<{ text: string; field: string }> {
  for (const [i, l] of (sc.then.output ?? []).entries()) {
    const text = typeof l === "string" ? l : (l.text ?? "");
    if (text) yield { text, field: `then.output[${i}]` };
  }
  for (const [i, l] of (sc.then.stderr ?? []).entries()) {
    const text = typeof l === "string" ? l : (l.text ?? "");
    if (text) yield { text, field: `then.stderr[${i}]` };
  }
  for (const [i, op] of (sc.then.files ?? []).entries()) {
    if (op.content)
      yield { text: op.content, field: `then.files[${i}].content` };
    if (op.with) yield { text: op.with, field: `then.files[${i}].with` };
  }
  for (const [k, v] of Object.entries(sc.then.state ?? {}))
    if (typeof v === "string") yield { text: v, field: `then.state.${k}` };
}

// ── Files the lab provides (seed + created), for :filelink existence ────────────

const providedFiles = new Set<string>(Object.keys(seedFiles));
for (const f of fences) {
  const saveAs = metaValue(f.meta, "save-as");
  if (saveAs) providedFiles.add(saveAs);
}
if (lab) {
  for (const sc of lab.scenarios) {
    for (const op of sc.then.files ?? []) {
      if (op.create) providedFiles.add(op.create);
      if (op.copy && op.to) providedFiles.add(op.to);
    }
  }
}
for (const fl of fileLinks) {
  if (!providedFiles.has(fl.path)) {
    warn(
      `section "${fl.section}"`,
      `:filelink to "${fl.path}", but no seed file, save-as block, or scenario creates it`,
    );
  }
}

// ── {{ state.x }} references nothing writes (WARNING) ──────────────────────────

for (const sr of stateRefs) {
  if (!writtenStatePaths.has(sr.path)) {
    warn(
      sr.at,
      `references {{ state.${sr.path} }} but nothing seeds or writes it`,
    );
  }
}

// ── Code-fence checks: terminal-id + reachability ──────────────────────────────

function promptCouldMatch(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  for (const sc of agentScenarios) {
    if (sc.when.prompt !== undefined) {
      if (sc.when.prompt.trim().toLowerCase() === trimmed) return true;
    } else if (sc.when.promptContains && sc.when.promptContains.length > 0) {
      if (
        sc.when.promptContains.every((k) => trimmed.includes(k.toLowerCase()))
      )
        return true;
    } else {
      return true; // catch-all agent scenario matches any prompt
    }
  }
  return false;
}

function commandPrefixExists(tokens: string[]): boolean {
  if (tokens.length > 0 && BUILTINS.includes(tokens[0])) return true;
  return commandPrefixes.some(
    (p) => p.length <= tokens.length && p.every((t, i) => t === tokens[i]),
  );
}

for (const f of fences) {
  const termId = metaValue(f.meta, "terminal-id");
  if (termId && !terminalIds.has(termId)) {
    err(
      `section "${f.section}" block #${f.index}`,
      `terminal-id="${termId}" is not a declared terminal`,
    );
  }

  // save-as blocks are file writes, not commands — skip reachability.
  if (metaValue(f.meta, "save-as") !== undefined) continue;
  // Blocks with the Run button hidden aren't executed.
  if (f.meta.includes("no-run-button")) continue;

  if (!SHELL_LANGS.has(f.lang)) {
    warn(
      `section "${f.section}" block #${f.index}`,
      `\`${f.lang}\` code block has a Run button but isn't shell — add \`save-as=\` or \`no-run-button\`?`,
    );
    continue;
  }

  for (const rawLine of f.content.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) line = line.slice(1).trim(); // !cmd inside a session
    if (line.startsWith("/")) continue; // session control (/exit, /quit)

    const resolved = substituteVars(line, variables);
    const tokens = tokenize(resolved);
    if (tokens.length === 0) continue;

    if (commandPrefixExists(tokens)) continue;
    if (promptCouldMatch(resolved)) continue;

    err(
      `section "${f.section}" block #${f.index}`,
      `no scenario command, built-in, or agent prompt handles: \`${line}\``,
    );
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────

function print(list: Finding[], symbol: string) {
  for (const f of list) console.log(`  ${symbol} ${f.where}: ${f.message}`);
}

console.log(`\nValidating lab: ${labDir}\n`);
if (errors.length) {
  console.log(`Errors (${errors.length}):`);
  print(errors, "✗");
}
if (warnings.length) {
  console.log(`${errors.length ? "\n" : ""}Warnings (${warnings.length}):`);
  print(warnings, "⚠");
}
if (!errors.length && !warnings.length) {
  console.log("✓ No issues found.");
} else {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
}
process.exit(errors.length ? 1 : 0);
