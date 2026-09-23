// Live authoring checks for one simulator.yaml.
//
// This is NOT a replacement for `npm run validate-lab`, which stays the
// authoritative, CI-gating check across a whole lab (markdown reachability,
// labspace cross-references, catalog regeneration). The editor exposes a button
// that runs the real thing. What lives here is the subset that can run on every
// keystroke against the in-memory model, so a broken reference shows up while
// you are looking at the field that broke it — each finding carries the model
// path it belongs to, so the UI can take you there.
//
// Where a check overlaps validate-lab, the wording is deliberately identical,
// so an author doesn't have to work out whether two tools are telling them the
// same thing.

import {
  Lab,
  OutputEntry,
  Scenario,
  Then,
  resolvePace,
} from "@dockersamples/simspace-simulator";
import { Analysis } from "./analyze";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** Where, for a human: `scenario "docker-run"`, `settings.pace`, … */
  where: string;
  message: string;
  /** Model path the UI can navigate to, e.g. `scenarios[3].then.output[1]`. */
  path?: string;
  /** Scenario id, when the finding belongs to one. */
  scenario?: string;
}

export interface LintContext {
  /** Terminal ids declared by the labspace that owns this spec. */
  terminalIds?: string[];
  /** Step ids cataloged by the owning labspace's sections. */
  stepIds?: string[];
  /** True when several entries share this spec, which makes id checks unsafe. */
  shared?: boolean;
  analysis: Analysis;
}

const ARG_TMPL = /\{\{\s*args\.([A-Za-z0-9_.]+)\s*\}\}/g;
const STATE_TMPL = /\{\{\s*state\.([A-Za-z0-9_.]+)\s*\}\}/g;
const INPUT_TMPL = /\{\{\s*input\.([A-Za-z0-9_.]+)\s*\}\}/g;

export function lint(lab: Lab, ctx: LintContext): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const err = (
    where: string,
    message: string,
    path?: string,
    scenario?: string,
  ) => add({ severity: "error", where, message, path, scenario });
  const warn = (
    where: string,
    message: string,
    path?: string,
    scenario?: string,
  ) => add({ severity: "warning", where, message, path, scenario });

  // ── Top level ─────────────────────────────────────────────────────────────
  if (!lab.version) {
    err("version", "simulator.yaml is missing a `version` field", "version");
  } else if (lab.version.split(".")[0] !== "2") {
    err(
      "version",
      `lab schema version "${lab.version}" is incompatible with simulator schema "2.0"`,
      "version",
    );
  }

  const paceNames = new Set(Object.keys(resolvePace(lab.settings)));
  const usedPace = new Set<string>();

  const workflowSteps = new Map(
    (lab.workflows ?? []).map((w) => [w.id, new Set(w.steps.map((s) => s.id))]),
  );
  countDuplicates((lab.workflows ?? []).map((w) => w.id)).forEach((id) =>
    err("workflows", `duplicate workflow id "${id}"`, "workflows"),
  );
  countDuplicates((lab.controls ?? []).map((c) => c.id)).forEach((id) =>
    err("controls", `duplicate control id "${id}"`, "controls"),
  );

  // Every state path something in the lab actually establishes: the seed, a
  // scenario effect, or a control. A reference to anything else is a typo.
  const written = new Set(
    ctx.analysis.state
      .filter((f) => f.seeded || f.writers.length || f.controls.length)
      .map((f) => f.path),
  );

  // ── Scenarios ─────────────────────────────────────────────────────────────
  countDuplicates(lab.scenarios.map((s) => s.id)).forEach((id) =>
    err(`scenario "${id}"`, `duplicate scenario id "${id}"`),
  );

  lab.scenarios.forEach((sc, i) => {
    const at = `scenario "${sc.id}"`;
    const base = `scenarios[${i}]`;
    const scErr = (m: string, p = base) => err(at, m, p, sc.id);
    const scWarn = (m: string, p = base) => warn(at, m, p, sc.id);

    if (!sc.id) scErr("`id` is required and must be unique");

    if (sc.when.agent && sc.when.command) {
      scErr(
        "`command` and `agent` are mutually exclusive — a scenario matches either a command or a prompt",
        `${base}.when`,
      );
    }
    if (!sc.when.agent && !sc.when.command) {
      scWarn(
        "no `command` and no `agent: true` — this scenario matches EVERY command, so nothing after it can fire",
        `${base}.when`,
      );
    }
    if (
      sc.when.terminal &&
      ctx.terminalIds &&
      !ctx.shared &&
      !ctx.terminalIds.includes(sc.when.terminal)
    ) {
      scErr(
        `when.terminal "${sc.when.terminal}" is not a declared terminal id`,
        `${base}.when.terminal`,
      );
    }
    if (
      sc.completes &&
      ctx.stepIds &&
      !ctx.shared &&
      !ctx.stepIds.includes(sc.completes)
    ) {
      scErr(
        `completes: "${sc.completes}" is not a step id cataloged by any section`,
        `${base}.completes`,
      );
    }

    if (!sc.when.agent && sc.when.promptContains?.length) {
      scWarn(
        "`promptContains` only applies to agent scenarios (`agent: true`) and is ignored here",
        `${base}.when.promptContains`,
      );
    }

    // An explicit `output: []` is an author saying "this command prints
    // nothing" (`git add` does exactly that), so only a `then` with no keys at
    // all is worth flagging.
    if (Object.keys(sc.then ?? {}).length === 0) {
      scWarn(
        "no effects — this scenario matches and then does nothing at all",
        `${base}.then`,
      );
    }

    for (const overlap of ctx.analysis.overlaps[sc.id] ?? []) {
      if (overlap.relation !== "shadowed-by") continue;
      scErr(
        `unreachable: "${overlap.id}" (#${overlap.index + 1}) comes first and ${overlap.reason}`,
        base,
      );
    }

    // `then` blocks, including an interactive request's resolution block.
    lintThen(sc.then, `${base}.then`, "then", sc, {
      scErr,
      scWarn,
      paceNames,
      usedPace,
      workflowSteps,
      written,
    });

    if (sc.then?.input) {
      if (sc.then.session) {
        scErr(
          "`then.input` and `then.session` are mutually exclusive — a command either collects input or opens a session",
          `${base}.then`,
        );
      }
      countDuplicates(sc.then.input.steps.map((s) => s.key)).forEach((key) =>
        scErr(`duplicate input step key "${key}"`, `${base}.then.input.steps`),
      );
      lintThen(
        sc.then.input.then,
        `${base}.then.input.then`,
        "then.input.then",
        sc,
        {
          scErr,
          scWarn,
          paceNames,
          usedPace,
          workflowSteps,
          written,
        },
      );
    }
  });

  // ── Cross-cutting warnings ────────────────────────────────────────────────
  for (const name of paceNames) {
    if (["short", "medium", "long"].includes(name)) continue;
    if (!usedPace.has(name)) {
      warn(
        "settings.pace",
        `pace profile "${name}" is declared but no output entry uses it`,
        "settings.pace",
      );
    }
  }

  for (const fact of ctx.analysis.state) {
    if (fact.readers.length && !written.has(fact.path)) {
      warn(
        "state",
        `"${fact.path}" is read by ${list(fact.readers)} but nothing seeds or writes it — check for a typo`,
        "state",
      );
    }
    if (
      !fact.readers.length &&
      !fact.requiredBy.length &&
      fact.writers.length &&
      !fact.path.startsWith("ci.")
    ) {
      warn(
        "state",
        `"${fact.path}" is written by ${list(fact.writers)} but nothing reads it`,
        "state",
      );
    }
  }

  for (const c of lab.controls ?? []) {
    const fact = ctx.analysis.state.find((f) => f.path === c.state);
    if (!fact?.readers.length && !fact?.requiredBy.length) {
      warn(
        `control "${c.id}"`,
        `writes "${c.state}", which no scenario or workflow step reads`,
        "controls",
      );
    }
  }

  if (ctx.stepIds && !ctx.shared) {
    for (const step of ctx.stepIds) {
      if (!ctx.analysis.completes.includes(step)) {
        warn(
          "completes",
          `step "${step}" is cataloged by a section but no scenario completes it`,
        );
      }
    }
  }

  return findings;
}

interface ThenCtx {
  scErr: (message: string, path?: string) => void;
  scWarn: (message: string, path?: string) => void;
  paceNames: Set<string>;
  usedPace: Set<string>;
  workflowSteps: Map<string, Set<string>>;
  written: Set<string>;
}

function lintThen(
  then: Then | undefined,
  base: string,
  label: string,
  sc: Scenario,
  ctx: ThenCtx,
): void {
  if (!then) return;

  // The spec's own `+=` example (§7.2) is not valid YAML — without a colon the
  // whole block parses as one string — so this is a trap worth naming exactly.
  if (then.state !== undefined && !isObject(then.state)) {
    ctx.scErr(
      '`state` must be a mapping of dot-path to value. A `+=` append still needs the colon: `events +=: "started"`',
      `${base}.state`,
    );
  }

  for (const stream of ["output", "stderr"] as const) {
    (then[stream] ?? []).forEach((entry: OutputEntry, i: number) => {
      if (typeof entry === "string") return;
      if (entry.delay === undefined) {
        if (entry.text === undefined) {
          ctx.scWarn(
            `${label}.${stream}[${i}] has neither \`text\` nor \`delay\` and prints nothing`,
            `${base}.${stream}[${i}]`,
          );
        }
        return;
      }
      if (typeof entry.delay === "number") {
        if (entry.delay < 0) {
          ctx.scErr(
            `${label}.${stream}[${i}].delay is negative (${entry.delay})`,
            `${base}.${stream}[${i}]`,
          );
        }
        return;
      }
      ctx.usedPace.add(entry.delay);
      if (!ctx.paceNames.has(entry.delay)) {
        ctx.scErr(
          `${label}.${stream}[${i}].delay "${entry.delay}" is not a known pace profile (add it under settings.pace)`,
          `${base}.${stream}[${i}]`,
        );
      }
    });
  }

  (then.files ?? []).forEach((op, i) => {
    const verbs = [
      "mkdir",
      "create",
      "append",
      "replace",
      "delete",
      "copy",
    ].filter((v) => (op as Record<string, unknown>)[v] !== undefined);
    if (verbs.length === 0) {
      ctx.scErr(
        `${label}.files[${i}] has no operation — one of mkdir/create/append/replace/delete/copy is required`,
        `${base}.files[${i}]`,
      );
    } else if (verbs.length > 1) {
      ctx.scErr(
        `${label}.files[${i}] sets more than one operation (${verbs.join(", ")}); each entry does exactly one thing`,
        `${base}.files[${i}]`,
      );
    }
    if (op.replace !== undefined && !op.find) {
      ctx.scErr(
        `${label}.files[${i}] is a \`replace\` with no \`find\`, which fails at run time`,
        `${base}.files[${i}]`,
      );
    }
    if (op.copy !== undefined && !op.to) {
      ctx.scErr(
        `${label}.files[${i}] is a \`copy\` with no \`to\``,
        `${base}.files[${i}]`,
      );
    }
  });

  const ci = then.ci;
  if (ci) {
    const steps = ctx.workflowSteps.get(ci.workflow);
    if (!steps) {
      ctx.scErr(
        `${label}.ci.workflow "${ci.workflow}" is not in the workflows catalog`,
        `${base}.ci`,
      );
    } else {
      if (ci.failedStep && !steps.has(ci.failedStep)) {
        ctx.scErr(
          `${label}.ci.failedStep "${ci.failedStep}" is not a step of "${ci.workflow}"`,
          `${base}.ci`,
        );
      }
      for (const ov of ci.steps ?? []) {
        if (!steps.has(ov.id)) {
          ctx.scErr(
            `${label}.ci.steps id "${ov.id}" is not a step of "${ci.workflow}"`,
            `${base}.ci`,
          );
        }
      }
    }
  }

  // Template references.
  const captures = new Set<string>();
  for (const [name, m] of Object.entries(sc.when.args ?? {})) {
    if (m.kind === "equals" || m.kind === "any" || m.kind === "oneOf") {
      captures.add(/^\d+$/.test(name) ? name : name.replace(/^-+/, ""));
    }
  }
  const inputKeys = new Set((sc.then?.input?.steps ?? []).map((s) => s.key));

  for (const { text, field, path } of templatableStrings(then, base, label)) {
    for (const m of text.matchAll(ARG_TMPL)) {
      if (!captures.has(m[1])) {
        ctx.scErr(
          `${field} references {{ args.${m[1]} }} but no matching capture in when.args`,
          path,
        );
      }
    }
    for (const m of text.matchAll(STATE_TMPL)) {
      if (!ctx.written.has(m[1])) {
        ctx.scWarn(
          `${field} references {{ state.${m[1]} }} but nothing seeds or writes that path`,
          path,
        );
      }
    }
    for (const m of text.matchAll(INPUT_TMPL)) {
      if (!inputKeys.has(m[1])) {
        ctx.scErr(
          `${field} references {{ input.${m[1]} }} but no input step declares key "${m[1]}"`,
          path,
        );
      }
    }
  }
}

/** Every templatable string in a `then` block, with a label and a model path. */
function* templatableStrings(
  then: Then,
  base: string,
  label: string,
): Generator<{ text: string; field: string; path: string }> {
  for (const stream of ["output", "stderr"] as const) {
    for (const [i, entry] of (then[stream] ?? []).entries()) {
      const text = typeof entry === "string" ? entry : (entry.text ?? "");
      if (text) {
        yield {
          text,
          field: `${label}.${stream}[${i}]`,
          path: `${base}.${stream}[${i}]`,
        };
      }
    }
  }
  for (const [i, op] of (then.files ?? []).entries()) {
    if (op.content) {
      yield {
        text: op.content,
        field: `${label}.files[${i}].content`,
        path: `${base}.files[${i}]`,
      };
    }
    if (op.with) {
      yield {
        text: op.with,
        field: `${label}.files[${i}].with`,
        path: `${base}.files[${i}]`,
      };
    }
  }
  if (isObject(then.state)) {
    for (const [key, value] of Object.entries(then.state)) {
      if (typeof value === "string") {
        yield {
          text: value,
          field: `${label}.state.${key}`,
          path: `${base}.state`,
        };
      }
    }
  }
  for (const [i, step] of (then.input?.steps ?? []).entries()) {
    if (step.prompt) {
      yield {
        text: step.prompt,
        field: `${label}.input.steps[${i}].prompt`,
        path: `${base}.input`,
      };
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function countDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

function list(ids: string[]): string {
  if (ids.length === 1) return `"${ids[0]}"`;
  if (ids.length === 2) return `"${ids[0]}" and "${ids[1]}"`;
  return `"${ids[0]}" and ${ids.length - 1} others`;
}
