// What a simulator.yaml doesn't show you.
//
// The file is an ordered list of rules, and the two things that actually decide
// what a learner sees are invisible in it: the ORDER (first match wins, so an
// earlier general rule silently eats a later specific one) and the STATE each
// rule reads and writes. Authors lose track of both, which is how "I only
// wanted to change a command" turns into a broken lab.
//
// So this module derives, from a parsed Lab:
//
//   - a summary per scenario: what triggers it, what state it requires and
//     sets, what effects it has, and an example command line that matches it
//   - overlaps: which other scenarios answer the same command, and which are
//     provably unreachable because an earlier one always wins
//   - a state map: every dot-path with its seed value and every touchpoint —
//     who reads it, who writes it, which control flips it, which CI step needs it
//   - transitions: which scenarios can produce the state a scenario requires
//     ("reached from") and which ones its own effects unlock ("leads to")
//
// It is pure and derives everything from the Lab the real engine parsed, so it
// can't disagree with the engine about what a scenario says.

import {
  DEFAULT_PACE,
  Lab,
  Matcher,
  Scenario,
  StateValue,
  When,
  resolvePace,
} from "@dockersamples/simspace-simulator";

export interface StatePair {
  path: string;
  value: StateValue;
  /** True for a `path +=` list-append effect. */
  append?: boolean;
}

export interface ScenarioSummary {
  index: number;
  id: string;
  description?: string;
  completes?: string;
  kind: "command" | "agent";
  /** Human-readable trigger, e.g. `docker run --name …` or `prompt ~ health`. */
  trigger: string;
  terminal?: string;
  requires: StatePair[];
  sets: StatePair[];
  /** Effect tags: output, stderr, files, state, session, input, ci, mcp, exit. */
  effects: string[];
  outputLines: number;
  /** Number of paced (`delay:`) output entries. */
  pacedLines: number;
  /** A command line that satisfies `when` (state aside), for the console. */
  example?: string;
}

export interface StateFact {
  path: string;
  /** Value in the lab's `state:` seed, when the path is seeded. */
  seed?: StateValue;
  seeded: boolean;
  /** Scenario ids reading it in `when.state`. */
  readers: string[];
  /** Scenario ids writing it in `then.state`. */
  writers: string[];
  /** Control ids whose toggle writes it. */
  controls: string[];
  /** `workflow/step` pairs gating a CI step on it. */
  requiredBy: string[];
}

export type OverlapRelation = "shadows" | "shadowed-by" | "same-trigger";

export interface Overlap {
  id: string;
  index: number;
  relation: OverlapRelation;
  /** Why, in one phrase, for the UI to show beside the id. */
  reason: string;
}

export interface Transitions {
  /** Scenario ids whose effects can satisfy this one's preconditions. */
  from: string[];
  /** Scenario ids whose preconditions this one's effects can satisfy. */
  to: string[];
}

export interface Analysis {
  scenarios: ScenarioSummary[];
  state: StateFact[];
  paceNames: string[];
  /** Overlaps keyed by scenario id. */
  overlaps: Record<string, Overlap[]>;
  /** Transitions keyed by scenario id. */
  transitions: Record<string, Transitions>;
  /** Terminal ids referenced by `when.terminal`. */
  terminals: string[];
  /** Step ids referenced by `completes:`. */
  completes: string[];
}

// ── Summaries ────────────────────────────────────────────────────────────────

export function analyze(lab: Lab): Analysis {
  const scenarios = lab.scenarios.map((sc, i) => summarize(sc, i));
  return {
    scenarios,
    state: stateMap(lab),
    paceNames: Object.keys(resolvePace(lab.settings)),
    overlaps: overlaps(lab.scenarios),
    transitions: transitions(lab.scenarios),
    terminals: unique(
      lab.scenarios.map((s) => s.when.terminal).filter(Boolean) as string[],
    ),
    completes: unique(
      lab.scenarios.map((s) => s.completes).filter(Boolean) as string[],
    ),
  };
}

export function summarize(sc: Scenario, index: number): ScenarioSummary {
  const then = sc.then ?? {};
  const effects: string[] = [];
  for (const key of [
    "output",
    "stderr",
    "files",
    "state",
    "session",
    "input",
    "ci",
    "mcp",
  ] as const) {
    const value = then[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    effects.push(key);
  }
  if (then.exit !== undefined && then.exit !== 0) effects.push("exit");

  const output = then.output ?? [];
  return {
    index,
    id: sc.id,
    description: sc.description,
    completes: sc.completes,
    kind: sc.when.agent ? "agent" : "command",
    trigger: triggerLabel(sc.when),
    terminal: sc.when.terminal,
    requires: statePairs(sc.when.state),
    sets: statePairs(then.state),
    effects,
    outputLines: output.length + (then.stderr ?? []).length,
    pacedLines: [...output, ...(then.stderr ?? [])].filter(
      (e) => typeof e !== "string" && e.delay !== undefined,
    ).length,
    example: sc.when.agent ? undefined : exampleCommand(sc.when),
  };
}

/** triggerLabel renders `when` as the one line a list row can show. */
export function triggerLabel(when: When): string {
  if (when.agent) {
    if (when.prompt) return `prompt = "${when.prompt}"`;
    if (when.promptContains?.length) {
      return `prompt ~ ${when.promptContains.join(" + ")}`;
    }
    return "any prompt";
  }
  const parts = [(when.command ?? []).join(" ")];
  for (const [name, m] of Object.entries(when.args ?? {})) {
    parts.push(argLabel(name, m));
  }
  if (when.prompt !== undefined) parts.push(`"${when.prompt}"`);
  return parts.filter(Boolean).join(" ") || "(no command)";
}

function argLabel(name: string, m: Matcher): string {
  const flag = /^\d+$/.test(name) ? `$${name}` : name;
  switch (m.kind) {
    case "equals":
      return `${flag}=${m.value}`;
    case "present":
      return flag;
    case "absent":
      return `!${flag}`;
    case "any":
      return `${flag}=*`;
    case "oneOf":
      return `${flag}=(${(m.oneOf ?? []).join("|")})`;
  }
}

/**
 * exampleCommand builds a command line that satisfies `when`'s command and args
 * — what the console's "Try it" runs. State preconditions are not part of a
 * command line, so a run may still land on a different scenario; the console
 * says so when it does, which is the useful half of the answer.
 */
export function exampleCommand(when: When): string | undefined {
  if (!when.command?.length) return undefined;
  const tokens = [...when.command];
  const positionals: string[] = [];

  for (const [name, m] of Object.entries(when.args ?? {})) {
    const positional = /^\d+$/.test(name);
    const value =
      m.kind === "equals"
        ? m.value
        : m.kind === "oneOf"
          ? m.oneOf?.[0]
          : m.kind === "any"
            ? positional
              ? "VALUE"
              : "VALUE"
            : undefined;
    if (m.kind === "absent") continue;
    if (positional) {
      positionals[Number(name)] = value ?? "VALUE";
      continue;
    }
    const flag = name.startsWith("-") ? name : `--${name}`;
    tokens.push(m.kind === "present" ? flag : `${flag} ${value ?? "VALUE"}`);
  }

  for (let i = 0; i < positionals.length; i++) {
    if (positionals[i] === undefined) positionals[i] = "VALUE";
  }
  const line = [
    ...when.command,
    ...positionals,
    ...tokens.slice(when.command.length),
  ]
    .filter((t) => t !== undefined && t !== "")
    .join(" ");
  return when.prompt ? `${line} ${when.prompt}`.trim() : line;
}

export function statePairs(
  state: Record<string, StateValue> | undefined,
): StatePair[] {
  return Object.entries(state ?? {}).map(([key, value]) => {
    const append = key.trimEnd().endsWith("+=");
    return {
      path: append ? key.replace(/\+=\s*$/, "").trim() : key.trim(),
      value,
      ...(append ? { append: true } : {}),
    };
  });
}

// ── State map ────────────────────────────────────────────────────────────────

function stateMap(lab: Lab): StateFact[] {
  const facts = new Map<string, StateFact>();
  const fact = (path: string): StateFact => {
    let f = facts.get(path);
    if (!f) {
      f = {
        path,
        seeded: false,
        readers: [],
        writers: [],
        controls: [],
        requiredBy: [],
      };
      facts.set(path, f);
    }
    return f;
  };

  for (const [path, value] of flattenState(lab.state)) {
    const f = fact(path);
    f.seeded = true;
    f.seed = value;
  }
  for (const sc of lab.scenarios) {
    for (const { path } of statePairs(sc.when.state)) {
      pushUnique(fact(path).readers, sc.id);
    }
    // A `{{ state.x }}` in an output line reads the path just as surely as a
    // precondition does — miss these and the state map calls a path that every
    // line of output depends on "unused".
    for (const path of templateStateRefs(sc)) {
      pushUnique(fact(path).readers, sc.id);
    }
    for (const { path } of statePairs(sc.then?.state)) {
      pushUnique(fact(path).writers, sc.id);
    }
    for (const { path } of statePairs(sc.then?.input?.then?.state)) {
      pushUnique(fact(path).writers, sc.id);
    }
  }
  for (const c of lab.controls ?? []) {
    pushUnique(fact(c.state).controls, c.id);
  }
  for (const w of lab.workflows ?? []) {
    for (const step of w.steps ?? []) {
      if (step.requires) {
        pushUnique(fact(step.requires).requiredBy, `${w.id}/${step.id}`);
      }
    }
  }

  return [...facts.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const STATE_TMPL = /\{\{\s*state\.([A-Za-z0-9_.]+)\s*\}\}/g;

/** Every `{{ state.<path> }}` a scenario's effects interpolate. */
export function templateStateRefs(sc: Scenario): string[] {
  const out: string[] = [];
  const scan = (text: unknown) => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(STATE_TMPL)) out.push(m[1]);
  };
  const scanThen = (then: Scenario["then"] | undefined) => {
    if (!then) return;
    for (const stream of ["output", "stderr"] as const) {
      for (const entry of then[stream] ?? []) {
        scan(typeof entry === "string" ? entry : entry.text);
      }
    }
    for (const op of then.files ?? []) {
      scan(op.content);
      scan(op.with);
    }
    for (const value of Object.values(then.state ?? {})) scan(value);
    for (const line of then.session?.intro ?? []) scan(line);
    for (const line of then.session?.outro ?? []) scan(line);
    for (const step of then.input?.steps ?? []) scan(step.prompt);
    scanThen(then.input?.then);
  };
  scanThen(sc.then);
  return out;
}

/**
 * flattenState walks the seed tree into dot-path/leaf pairs. Intermediate nodes
 * are included too, because a scenario may compare against a subtree.
 */
export function flattenState(
  state: StateValue | undefined,
  prefix = "",
  out: [string, StateValue][] = [],
): [string, StateValue][] {
  if (prefix) out.push([prefix, state ?? null]);
  if (state && typeof state === "object" && !Array.isArray(state)) {
    for (const [key, value] of Object.entries(state)) {
      flattenState(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

// ── Overlaps: who answers the same command, and who never gets a turn ────────

/**
 * overlaps reports, per scenario, the other scenarios that compete for the same
 * input. `shadows` / `shadowed-by` is the certain case: an EARLIER scenario
 * whose conditions are implied by a LATER one's always wins, so the later one
 * can never fire. Everything else that shares a trigger is reported without a
 * verdict, because whether it competes depends on state the author controls.
 */
export function overlaps(scenarios: Scenario[]): Record<string, Overlap[]> {
  const out: Record<string, Overlap[]> = {};
  for (const sc of scenarios) out[sc.id] = [];

  for (let i = 0; i < scenarios.length; i++) {
    for (let j = i + 1; j < scenarios.length; j++) {
      const earlier = scenarios[i];
      const later = scenarios[j];
      if (!sameKind(earlier.when, later.when)) continue;
      if (!sharesTrigger(earlier.when, later.when)) continue;

      if (implies(later.when, earlier.when)) {
        const reason = shadowReason(earlier.when, later.when);
        out[later.id].push({
          id: earlier.id,
          index: i,
          relation: "shadowed-by",
          reason,
        });
        out[earlier.id].push({
          id: later.id,
          index: j,
          relation: "shadows",
          reason,
        });
      } else {
        out[later.id].push({
          id: earlier.id,
          index: i,
          relation: "same-trigger",
          reason: "matches the same command",
        });
        out[earlier.id].push({
          id: later.id,
          index: j,
          relation: "same-trigger",
          reason: "matches the same command",
        });
      }
    }
  }
  return out;
}

function sameKind(a: When, b: When): boolean {
  return Boolean(a.agent) === Boolean(b.agent);
}

/** sharesTrigger reports whether two scenarios can ever see the same input. */
function sharesTrigger(a: When, b: When): boolean {
  if (a.agent || b.agent) return true;
  const x = a.command ?? [];
  const y = b.command ?? [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * implies reports whether every input matching `specific` also matches
 * `general` — i.e. `general`, placed first, makes `specific` unreachable.
 * Conservative: anything it can't prove, it doesn't claim.
 */
function implies(specific: When, general: When): boolean {
  // Command: the general path must be a prefix of the specific one.
  const gCmd = general.command ?? [];
  const sCmd = specific.command ?? [];
  if (!general.agent) {
    if (gCmd.length > sCmd.length) return false;
    for (let i = 0; i < gCmd.length; i++) {
      if (gCmd[i] !== sCmd[i]) return false;
    }
  }

  // Terminal: unscoped matches everywhere; scoped must be the same terminal.
  if (
    general.terminal !== undefined &&
    general.terminal !== specific.terminal
  ) {
    return false;
  }

  // Args: every condition the general one imposes must also be imposed, the
  // same way, by the specific one.
  for (const [name, m] of Object.entries(general.args ?? {})) {
    const other = specific.args?.[name];
    if (!other || !sameMatcher(m, other)) return false;
  }

  // State: same, by equality of the expected value.
  for (const { path, value } of statePairs(general.state)) {
    const hit = statePairs(specific.state).find((p) => p.path === path);
    if (!hit || JSON.stringify(hit.value) !== JSON.stringify(value)) {
      return false;
    }
  }

  // Prompt conditions, for both command and agent scenarios.
  if (general.prompt !== undefined && general.prompt !== specific.prompt) {
    return false;
  }
  for (const needle of general.promptContains ?? []) {
    const has = (specific.promptContains ?? []).some(
      (n) => n.toLowerCase() === needle.toLowerCase(),
    );
    if (!has) return false;
  }
  return true;
}

function sameMatcher(a: Matcher, b: Matcher): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shadowReason(general: When, specific: When): string {
  const gState = statePairs(general.state).length;
  const sState = statePairs(specific.state).length;
  const gArgs = Object.keys(general.args ?? {}).length;
  const sArgs = Object.keys(specific.args ?? {}).length;
  if (sState > gState)
    return "it checks less state, so it always matches first";
  if (sArgs > gArgs)
    return "it checks fewer arguments, so it always matches first";
  if ((general.command ?? []).length < (specific.command ?? []).length) {
    return "its command prefix is shorter, so it always matches first";
  }
  return "its conditions are a subset, so it always matches first";
}

// ── Transitions: the state machine as a graph ────────────────────────────────

/**
 * transitions links scenarios through state. A scenario is "reached from"
 * another when that one's effects can satisfy one of its preconditions, and
 * "leads to" the scenarios its own effects unlock. This is the answer to "if I
 * change this precondition, what stops working?"
 */
export function transitions(
  scenarios: Scenario[],
): Record<string, Transitions> {
  const out: Record<string, Transitions> = {};
  for (const sc of scenarios) out[sc.id] = { from: [], to: [] };

  for (const producer of scenarios) {
    const writes = [
      ...statePairs(producer.then?.state),
      ...statePairs(producer.then?.input?.then?.state),
    ];
    if (!writes.length) continue;
    for (const consumer of scenarios) {
      if (consumer.id === producer.id) continue;
      const needs = statePairs(consumer.when.state);
      if (!needs.length) continue;
      const satisfies = needs.some((need) =>
        writes.some(
          (write) =>
            write.path === need.path &&
            !write.append &&
            valueMatches(write.value, need.value),
        ),
      );
      if (satisfies) {
        pushUnique(out[consumer.id].from, producer.id);
        pushUnique(out[producer.id].to, consumer.id);
      }
    }
  }
  return out;
}

/**
 * valueMatches compares a written value against an expected one the way the
 * engine's state matching does, with one allowance: a written template
 * (`"{{ args.name }}"`) could resolve to anything, so it counts as a match for
 * any expected string.
 */
function valueMatches(written: StateValue, expected: StateValue): boolean {
  if (typeof written === "string" && written.includes("{{")) {
    return typeof expected === "string";
  }
  return JSON.stringify(written) === JSON.stringify(expected);
}

// ── Comments: the section banners an author navigates by ─────────────────────

export interface ScenarioComments {
  /** A comment block directly above the scenario — its own note. */
  note?: string;
  /** A comment block separated by a blank line — a banner for what follows. */
  banner?: string;
}

/**
 * scenarioComments reads the comment blocks around each scenario out of the
 * source, so the editor's list can show the author's own section banners rather
 * than one flat list of 30 ids. The blank-line rule matches the patcher's: a
 * comment touching a scenario belongs to it, one separated by a blank line
 * heads the section.
 */
export function scenarioComments(lines: string[]): ScenarioComments[] {
  const out: ScenarioComments[] = [];
  let inScenarios = false;
  let itemIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^scenarios:\s*(#.*)?$/.test(line)) {
      inScenarios = true;
      continue;
    }
    if (!inScenarios) continue;
    // A non-indented, non-comment, non-blank line ends the scenarios block.
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break;

    const m = line.match(/^(\s*)-\s/);
    if (!m) continue;
    if (itemIndent === -1) itemIndent = m[1].length;
    if (m[1].length !== itemIndent) continue;

    // Walk up: comment lines directly above are the note; after a blank line,
    // a further comment block is the banner.
    const note: string[] = [];
    let j = i - 1;
    while (j >= 0 && /^\s*#/.test(lines[j])) note.unshift(strip(lines[j--]));
    const banner: string[] = [];
    if (j >= 0 && /^\s*$/.test(lines[j])) {
      let k = j - 1;
      while (k >= 0 && /^\s*$/.test(lines[k])) k--;
      while (k >= 0 && /^\s*#/.test(lines[k]))
        banner.unshift(strip(lines[k--]));
    }
    out.push({
      ...(note.length ? { note: note.join("\n") } : {}),
      ...(banner.length ? { banner: banner.join("\n") } : {}),
    });
  }
  return out;
}

function strip(line: string): string {
  return line.replace(/^\s*#\s?/, "").trimEnd();
}

// ── Small helpers ────────────────────────────────────────────────────────────

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/** Built-in pace profile names, always available to a lab. */
export const BUILTIN_PACE = Object.keys(DEFAULT_PACE);
