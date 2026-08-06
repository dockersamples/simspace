// validate-lab: static checks for a Labspace labs/ tree, and (re)generation of
// the labs.json catalog.
//
//   npm run validate-lab -- <labs-dir>      (default: public/labs)
//
// Every lab lives in its own `labs/<id>/` directory. This validates each one
// with the SAME engine parser the app uses, then reports authoring mistakes
// without anyone writing assertions. It also regenerates `labs.json` from the
// labs so the catalog can't go missing or drift — the deploy-blocking case for
// anyone moving a single-lab repo onto this layout. Severities:
//
//   ERROR   (exit 1) — broken: no labs found, a lab won't parse, a reference
//                      dangles, a template placeholder has no capture, or the
//                      markdown tells the learner to run a command no scenario,
//                      built-in, or agent prompt can handle.
//   WARNING (exit 0) — likely a mistake worth a look: a :filelink to a file the
//                      lab never provides, a {{ state.x }} nothing writes, a
//                      Run button on a non-shell block, a duplicate id.
//
// It intentionally does NOT simulate a full playthrough (which would need to
// know when prose tells the learner to flip a Settings toggle). Reachability is
// checked by command-prefix existence, which has no state false-positives.

import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  parseManifest,
  checkSchemaVersion,
  resolvePace,
  tokenize,
  Lab,
  Scenario,
  StateValue,
} from "@dockersamples/simspace-simulator";
import {
  buildCatalog,
  findLabDirs,
  catalogJson,
  entryKind,
  KINDS,
} from "./catalog.mjs";
import { parseSlides } from "../src/deck/splitSlides.js";
import { LAYOUTS, THEMES } from "../src/context/DeckContext.jsx";

// ── Reporting ─────────────────────────────────────────────────────────────────

interface Finding {
  where: string;
  message: string;
}

// ── Helpers (pure) ──────────────────────────────────────────────────────────

const BUILTINS = ["ls", "cat"];
const SHELL_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "",
  "text",
  // `prompt` renders as plaintext but keeps its Run button (an AI prompt typed
  // into the terminal). Treat it as runnable so its lines are checked for
  // reachability — typically against an agent scenario (`when.agent`).
  "prompt",
]);
const ARG_TMPL = /\{\{\s*args\.([A-Za-z0-9_.]+)\s*\}\}/g;
const STATE_TMPL = /\{\{\s*state\.([A-Za-z0-9_.]+)\s*\}\}/g;
const INPUT_TMPL = /\{\{\s*input\.([A-Za-z0-9_.]+)\s*\}\}/g;

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

/** Yield every templatable string in a `then` block, tagged with a field name. */
function* thenBlockStrings(
  then: Scenario["then"],
  prefix: string,
): Generator<{ text: string; field: string }> {
  for (const [i, l] of (then.output ?? []).entries()) {
    const text = typeof l === "string" ? l : (l.text ?? "");
    if (text) yield { text, field: `${prefix}.output[${i}]` };
  }
  for (const [i, l] of (then.stderr ?? []).entries()) {
    const text = typeof l === "string" ? l : (l.text ?? "");
    if (text) yield { text, field: `${prefix}.stderr[${i}]` };
  }
  for (const [i, op] of (then.files ?? []).entries()) {
    if (op.content)
      yield { text: op.content, field: `${prefix}.files[${i}].content` };
    if (op.with) yield { text: op.with, field: `${prefix}.files[${i}].with` };
  }
  for (const [k, v] of Object.entries(then.state ?? {}))
    if (typeof v === "string") yield { text: v, field: `${prefix}.state.${k}` };
}

/** Yield every templatable string in a scenario's `then`, tagged with a field
 * name. Includes an interactive input request's step prompts and its resolution
 * `then` block, so template placeholders there are checked too. */
function* thenStrings(
  sc: Scenario,
): Generator<{ text: string; field: string }> {
  yield* thenBlockStrings(sc.then, "then");
  const input = sc.then.input;
  if (input) {
    for (const [i, step] of input.steps.entries())
      if (step.prompt)
        yield { text: step.prompt, field: `then.input.steps[${i}].prompt` };
    yield* thenBlockStrings(input.then, "then.input.then");
  }
}

// ── Per-lab validation ──────────────────────────────────────────────────────

function validateLab(labDir: string): {
  errors: Finding[];
  warnings: Finding[];
} {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (where: string, message: string) =>
    errors.push({ where, message });
  const warn = (where: string, message: string) =>
    warnings.push({ where, message });

  const fileLinks: { path: string; section: string }[] = [];
  const stateRefs: { path: string; at: string }[] = [];

  const labspacePath = join(labDir, "labspace.yaml");
  if (!existsSync(labspacePath)) {
    err("labspace.yaml", `no labspace.yaml in ${labDir}`);
    return { errors, warnings };
  }

  let labspace: Record<string, unknown>;
  try {
    labspace = parseYaml(readFileSync(labspacePath, "utf8")) ?? {};
  } catch (e) {
    err("labspace.yaml", `does not parse: ${(e as Error).message}`);
    return { errors, warnings };
  }
  if (typeof labspace !== "object" || labspace === null) {
    err("labspace.yaml", "must be a mapping");
    return { errors, warnings };
  }

  // "lab" or "slides". Recognized here rather than trusted, so a typo'd kind is
  // reported instead of silently making the entry open as a lab.
  const kindRaw = labspace.kind;
  if (kindRaw !== undefined && !KINDS.includes(kindRaw as string)) {
    err(
      "labspace.yaml",
      `unknown kind "${kindRaw}" — expected one of: ${KINDS.join(", ")}`,
    );
  }
  const kind = entryKind(labspace);
  const isDeck = kind === "slides";

  const simulatorRel = labspace.simulator as string | undefined;
  // A lab is defined by its simulated commands, so the spec is required. A deck
  // only needs one for live demos, so there it's optional.
  if (!simulatorRel && !isDeck) {
    err("labspace.yaml", "missing required `simulator:` field");
  }

  // Whether the simulator spec lives OUTSIDE this entry's own directory — the
  // recommended pattern for a deck, which points at its sibling lab's spec so the
  // demos and the exercise can't drift apart.
  //
  // A shared spec's terminal ids and `completes:` step ids belong to the entry
  // that OWNS it, and are validated there. Cross-checking them against this
  // entry would report an error on every deck that correctly reuses a lab's
  // spec, which would train authors to ignore the validator.
  const sharedSimulator = Boolean(
    simulatorRel &&
    (simulatorRel.startsWith("../") || simulatorRel.startsWith("/")),
  );

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
  const services =
    (labspace.services as { id?: string; title?: string }[]) ?? [];
  // A deck writes `slides:`; a lab writes `sections:`. They're the same list, so
  // everything below — dangling contentPath, Run-button reachability, :filelink
  // targets, {{ state }} refs — checks a deck's markdown exactly as a lab's.
  type SectionDef = {
    title?: string;
    contentPath?: string;
    steps?: { id?: string; title?: string }[];
  };
  const sections =
    (labspace.slides as SectionDef[]) ??
    (labspace.sections as SectionDef[]) ??
    [];
  if (labspace.slides && labspace.sections) {
    warn(
      "labspace.yaml",
      "declares both `slides:` and `sections:` — they are aliases, so only `slides:` is read",
    );
  }
  if (labspace.slides && !isDeck) {
    warn(
      "labspace.yaml",
      "uses `slides:` without `kind: slides` — it will run as a lab, as one continuous page",
    );
  }

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

  // ── Duplicate-id checks (WARNING) ──────────────────────────────────────────
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
    services.map(
      (s, i) => s.id ?? (s.title ? slugify(s.title) : `service-${i}`),
    ),
    "service",
  );

  // ── Section files (ERROR) ──────────────────────────────────────────────────
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

    // ── Slide config (deck only) ─────────────────────────────────────────────
    // Parsed with the SAME splitter the app uses, so what's checked here is
    // exactly what will render. A slide's config is deliberately forgiving at
    // runtime (a typo'd layout falls back to `default` rather than blanking the
    // slide mid-talk), which is precisely why it has to be strict here.
    if (isDeck) {
      const chapterId = slugify(s.title ?? "") || `chapter-${i + 1}`;
      for (const slide of parseSlides(raw, { chapterId })) {
        const at = `slide "${slide.id}"`;
        if (slide.configError) {
          err(at, `config block does not parse: ${slide.configError}`);
          continue;
        }
        const { layout, theme } = slide.config;
        if (layout !== undefined && !LAYOUTS.includes(layout)) {
          err(
            at,
            `unknown layout "${layout}" — expected one of: ${LAYOUTS.join(", ")}`,
          );
        }
        if (theme !== undefined && !THEMES.includes(theme)) {
          err(
            at,
            `unknown theme "${theme}" — expected one of: ${THEMES.join(", ")}`,
          );
        }
        // A region marker only means something to `split`; anywhere else the
        // regions are joined back together, so the break silently does nothing.
        if (slide.regions.length > 1 && layout !== "split") {
          warn(
            at,
            `has ${slide.regions.length} regions but layout is "${layout ?? "default"}" — only \`layout: split\` renders columns`,
          );
        }
        if (layout === "split" && slide.regions.length < 2) {
          warn(
            at,
            "`layout: split` with no `<!-- region -->` marker renders a single column",
          );
        }
        // A logo path is relative to the slide's own directory.
        if (
          typeof slide.config.logo === "string" &&
          !/^([a-z]+:)?\/\//i.test(slide.config.logo) &&
          !slide.config.logo.startsWith("/")
        ) {
          const logoPath = join(dirname(p), slide.config.logo);
          if (!existsSync(logoPath)) {
            err(at, `logo not found: ${slide.config.logo}`);
          }
        }
      }
    }

    // :filelink paths referenced in prose.
    for (const fm of raw.matchAll(
      /:filelink\[[^\]]*\]\{[^}]*path="([^"]+)"[^}]*\}/g,
    )) {
      fileLinks.push({ path: fm[1], section: label });
    }
  }

  // ── Cross-file reference checks against the parsed simulator (ERROR) ────────
  const commandPrefixes: string[][] = [];
  const agentScenarios: Scenario[] = [];
  const writtenStatePaths = new Set<string>();

  if (lab) {
    flattenPaths(lab.state, "", writtenStatePaths);
    for (const c of lab.controls ?? []) writtenStatePaths.add(c.state);

    const workflowIds = new Map(
      (lab.workflows ?? []).map((w) => [
        w.id,
        new Set(w.steps.map((s) => s.id)),
      ]),
    );

    const paceNames = new Set(Object.keys(resolvePace(lab.settings)));

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

      // Only meaningful for a spec this entry owns. In a shared spec the ids
      // belong to the owning entry (see sharedSimulator) — a deck reusing a
      // lab's spec simply never fires the scenarios scoped to the lab's other
      // terminals, which is intended, not a mistake.
      if (
        sc.when.terminal &&
        !terminalIds.has(sc.when.terminal) &&
        !sharedSimulator
      ) {
        err(
          at,
          `when.terminal "${sc.when.terminal}" is not a declared terminal id`,
        );
      }

      if (sc.when.agent) agentScenarios.push(sc);
      else if (sc.when.command) commandPrefixes.push(sc.when.command);

      for (const key of [
        ...Object.keys(sc.then.state ?? {}),
        ...Object.keys(sc.then.input?.then.state ?? {}),
      ]) {
        writtenStatePaths.add(key.replace(/\+=$/, "").trim());
      }

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

      const captures = new Set<string>();
      for (const [name, m] of Object.entries(sc.when.args ?? {})) {
        if (m.kind === "equals" || m.kind === "any" || m.kind === "oneOf") {
          captures.add(captureKey(name));
        }
      }
      // Keys collected by an interactive input request, referenceable as
      // {{ input.<key> }} inside its resolution `then` (and step prompts).
      const inputKeys = new Set((sc.then.input?.steps ?? []).map((s) => s.key));
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
        for (const im of text.matchAll(INPUT_TMPL)) {
          if (!inputKeys.has(im[1])) {
            err(
              at,
              `${field} references {{ input.${im[1]} }} but no input step declares key "${im[1]}"`,
            );
          }
        }
      }
    }

    // ── Step catalog ↔ scenario `completes:` cross-check ──────────────────────
    // labspace.yaml sections own the step catalog (what appears in the progress
    // UI); simulator.yaml scenarios reference step ids via `completes:`. Flag a
    // scenario completing an unknown step (ERROR) and a cataloged step nothing
    // completes (WARNING — unreachable). Mirrors the loader's default-id rule.
    const catalogStepIds = new Set<string>();
    const stepIdCounts = new Map<string, number>();
    for (const [i, s] of sections.entries()) {
      for (const [j, step] of (s.steps ?? []).entries()) {
        const id = step.id ?? (step.title ? slugify(step.title) : "");
        if (!id) {
          err(
            "labspace.yaml",
            `section "${s.title ?? `#${i}`}" step #${j} has neither id nor title`,
          );
          continue;
        }
        catalogStepIds.add(id);
        stepIdCounts.set(id, (stepIdCounts.get(id) ?? 0) + 1);
      }
    }
    for (const [id, n] of stepIdCounts) {
      if (n > 1) warn("labspace.yaml", `duplicate step id "${id}"`);
    }

    const completedStepIds = new Set<string>();
    for (const sc of lab.scenarios) {
      if (!sc.completes) continue;
      completedStepIds.add(sc.completes);
      // Same reasoning as when.terminal above: in a shared spec the step ids
      // belong to the entry that owns it. An entry that declares no steps at all
      // simply doesn't track progress, which is already opt-in.
      if (!catalogStepIds.has(sc.completes) && !sharedSimulator) {
        err(
          `scenario "${sc.id}"`,
          `completes "${sc.completes}" is not a step id in any section's steps: catalog`,
        );
      }
    }
    for (const id of catalogStepIds) {
      if (!completedStepIds.has(id)) {
        warn(
          "labspace.yaml",
          `step "${id}" is cataloged but no scenario completes it (unreachable)`,
        );
      }
    }
  }

  // ── Files the lab provides (seed + created), for :filelink existence ────────
  const providedFiles = new Set<string>(Object.keys(seedFiles));
  for (const f of fences) {
    const saveAs = metaValue(f.meta, "save-as");
    if (saveAs) providedFiles.add(saveAs);
  }
  if (lab) {
    for (const sc of lab.scenarios) {
      // A scenario's own file ops plus those in an input request's resolution.
      const fileOps = [
        ...(sc.then.files ?? []),
        ...(sc.then.input?.then.files ?? []),
      ];
      for (const op of fileOps) {
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

  // ── {{ state.x }} references nothing writes (WARNING) ──────────────────────
  for (const sr of stateRefs) {
    if (!writtenStatePaths.has(sr.path)) {
      warn(
        sr.at,
        `references {{ state.${sr.path} }} but nothing seeds or writes it`,
      );
    }
  }

  // ── Code-fence checks: terminal-id + reachability ──────────────────────────
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

    if (metaValue(f.meta, "save-as") !== undefined) continue;
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
      if (line.startsWith("!")) line = line.slice(1).trim(); // !cmd in a session
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

  return { errors, warnings };
}

// ── Driver ──────────────────────────────────────────────────────────────────

const cwd = process.cwd();
const arg = process.argv[2] ?? "public/labs";
const labsDir = resolve(arg);

if (!existsSync(labsDir) || !statSync(labsDir).isDirectory()) {
  console.error(`✗ labs directory not found: ${labsDir}`);
  process.exit(2);
}

const labIds = findLabDirs(labsDir);
if (labIds.length === 0) {
  console.error(`\n✗ No labs found under ${labsDir}`);
  if (existsSync(join(labsDir, "labspace.yaml"))) {
    console.error(
      "  Found a labspace.yaml directly in this directory, but the layout is now",
    );
    console.error(
      "  labs/<id>/ — move this lab into a subdirectory (e.g. labs/intro/labspace.yaml).",
    );
  } else {
    console.error(
      "  Expected one or more labs/<id>/labspace.yaml. If you're migrating a",
    );
    console.error(
      "  single-lab repo, move lab/ into labs/<id>/ (any id) and re-run.",
    );
  }
  process.exit(1);
}

let totalErrors = 0;
let totalWarnings = 0;

console.log(`\nValidating ${labIds.length} lab(s) under ${labsDir}`);

for (const id of labIds) {
  const { errors, warnings } = validateLab(join(labsDir, id));
  totalErrors += errors.length;
  totalWarnings += warnings.length;

  console.log(`\n── ${id} ──`);
  if (!errors.length && !warnings.length) {
    console.log("  ✓ No issues found.");
    continue;
  }
  for (const f of errors) console.log(`  ✗ ${f.where}: ${f.message}`);
  for (const f of warnings) console.log(`  ⚠ ${f.where}: ${f.message}`);
}

// Regenerate the catalog so labs.json always reflects the labs on disk (and so a
// missing/stale catalog can't slip through to deploy). Best-effort: a read-only
// mount shouldn't fail validation. Skip if a lab failed to parse — a broken lab
// already fails the run, and buildCatalog would just rethrow the same error.
const outPath = join(labsDir, "..", "labs.json");
if (totalErrors === 0) {
  try {
    writeFileSync(outPath, catalogJson(labsDir));
    console.log(
      `\n✓ Wrote ${relative(cwd, outPath)} (${buildCatalog(labsDir).labs.length} lab(s)).`,
    );
  } catch (e) {
    console.log(
      `\n⚠ Could not write ${relative(cwd, outPath)} (${(e as Error).message}). ` +
        "It's regenerated at dev/build/deploy, so this is only a problem if you serve these files directly.",
    );
  }
}

console.log(
  `\n${totalErrors} error(s), ${totalWarnings} warning(s) across ${labIds.length} lab(s).`,
);
process.exit(totalErrors ? 1 : 0);
