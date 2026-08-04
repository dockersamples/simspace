// Type definitions for the terminal simulator lab manifest and engine.

/** SchemaVersion is the scenario schema version this build understands. */
export const SchemaVersion = "2.0";

/** A JSON-compatible value, matching the untyped `any` state tree in Go. */
export type StateValue =
  | null
  | boolean
  | number
  | string
  | StateValue[]
  | { [key: string]: StateValue };

/** How an argument value is tested (mirrors manifest.MatcherKind). */
export type MatcherKind =
  | "equals" // arg present and equal to `value`
  | "present" // flag/arg present (any value)
  | "absent" // flag/arg not present
  | "any" // present with any value (and captured)
  | "oneOf"; // present and value is one of `oneOf`

/** Matcher tests a single command argument. */
export interface Matcher {
  kind: MatcherKind;
  value?: string;
  oneOf?: string[];
}

/** When holds the conditions that must all hold for a scenario to fire. */
export interface When {
  /** Command token path (e.g. ["docker", "run"]). Always normalized to a token list. */
  command?: string[];
  args?: Record<string, Matcher>;
  agent?: boolean;
  prompt?: string;
  promptContains?: string[];
  state?: Record<string, StateValue>;
  /**
   * The id of the terminal the command must come from. Omitted means the
   * scenario matches commands from any terminal.
   */
  terminal?: string;
}

/** A single filesystem mutation. Exactly one operation verb is set. */
export interface FileOp {
  mkdir?: string;
  create?: string;
  append?: string;
  replace?: string;
  delete?: string;
  copy?: string;

  content?: string; // for create/append
  find?: string; // for replace
  with?: string; // for replace
  to?: string; // for copy
}

/**
 * An output entry. Either a bare string (printed at the default cadence) or an
 * object that can carry a cosmetic `delay` before the line appears. An object
 * with no `text` is a pure pause — the terminal waits, but renders nothing.
 * `delay` is either a literal millisecond count or the name of a pace profile
 * declared in `settings.pace` (§13). Delays are presentation-only and never
 * change what is printed, so labs stay deterministic.
 */
export type OutputEntry = string | { text?: string; delay?: number | string };

/**
 * A fully-resolved output line produced by the engine: the templated text plus
 * an optional cosmetic delay (in ms) and a pure-pause flag. Delay-profile names
 * are already resolved to numbers here, so the UI needs no knowledge of pace.
 */
export interface RenderedLine {
  text: string;
  /** Cosmetic delay (ms) to wait before revealing this line. Undefined = default cadence. */
  delayMs?: number;
  /** When true this line renders nothing — it exists only to pace the output. */
  pause?: boolean;
}

/** A mocked MCP tool invocation rendered as terminal output. */
export interface MCPCall {
  tool: string;
  arguments?: Record<string, StateValue>;
  result?: string;
}

/** Session config: entering an interactive agent REPL. */
export interface Session {
  intro?: string[];
  prompt?: string;
  outro?: string[];
}

/**
 * One question in an interactive input request (§7.5). The terminal shows
 * `prompt` at the caret, collects a line, and stores it under `key` so the
 * request's resolution `then` can read it as `{{ input.<key> }}`.
 */
export interface InputStep {
  /** Name the collected value is stored under (referenced as {{ input.<key> }}). */
  key: string;
  /** Label shown at the input caret while this step is collected (e.g. "Password: "). */
  prompt: string;
  /** When true, typed characters are masked (for secrets). Default false. */
  mask?: boolean;
}

/**
 * An interactive input request declared by `then.input`. After the opening
 * command's effects are applied, the terminal collects one line per step, then
 * applies `then` with the collected values in scope. Bounded and deterministic:
 * every submission of the same values yields the same effects (no branching).
 */
export interface InputRequest {
  /** Ordered questions to ask. A single-step author form normalizes to one step. */
  steps: InputStep[];
  /** Effects applied once every step is answered. Reads {{ input.<key> }}. */
  then: Then;
}

/** The logs/error a step surfaces when its `requires` condition is unmet. */
export interface WorkflowStepFailure {
  /** Error message surfaced on the run when this step is the failing one. */
  error?: string;
  /** Log lines shown for this step when it fails (instead of `logs`). */
  logs?: string[];
}

/** One step in a CI workflow definition (§CI). */
export interface WorkflowStep {
  id: string;
  name: string;
  /** Condensed default log lines shown when the step succeeds. */
  logs?: string[];
  /**
   * A state dot-path that must be truthy for this step to succeed. When a run's
   * conclusion is derived from state (a `then.ci` with no explicit
   * `conclusion`), the first step whose `requires` is unmet fails the run. Steps
   * with no `requires` always pass.
   */
  requires?: string;
  /** Logs/error to surface when `requires` is unmet. */
  failure?: WorkflowStepFailure;
}

/**
 * A reusable CI workflow definition, declared once in the top-level
 * `workflows:` catalog and referenced by a scenario's `then.ci`.
 */
export interface Workflow {
  id: string;
  name: string;
  /** Cosmetic trigger label (e.g. "push"); shown in the run header. */
  on?: string;
  steps: WorkflowStep[];
}

/** A per-run override/addition for a single workflow step. */
export interface CIStepOverride {
  /** The workflow step id this override applies to. */
  id: string;
  name?: string;
  /** Replaces the step's default logs for this run. */
  logs?: string[];
}

/**
 * A CI trigger effect. When a scenario fires, it resolves the referenced
 * workflow into a fully-determined run record and appends it to
 * `state.ci.runs`. The engine adds no time or randomness — the run is complete
 * and deterministic; the CI panel plays it back cosmetically.
 */
export interface CITrigger {
  /** The id of a workflow in the top-level `workflows:` catalog. */
  workflow: string;
  /** Commit label shown in the run header (optional). */
  commit?: string;
  /** Overall outcome. Defaults to "success". */
  conclusion?: "success" | "failure";
  /** The step id that fails (default: the last step) when conclusion is failure. */
  failedStep?: string;
  /** Per-run step log overrides/additions, matched by step id. */
  steps?: CIStepOverride[];
  /** Error message surfaced on the run when conclusion is failure. */
  error?: string;
}

/** Then holds the effects applied when a scenario fires. */
export interface Then {
  files?: FileOp[];
  state?: Record<string, StateValue>;
  output?: OutputEntry[];
  stderr?: OutputEntry[];
  exit?: number;
  mcp?: MCPCall[];
  session?: Session;
  /** Enter interactive input collection after applying this scenario's effects (§7.5). */
  input?: InputRequest;
  ci?: CITrigger;
}

/** Scenario is one ordered match rule. */
export interface Scenario {
  id: string;
  description?: string;
  /**
   * The id of a step this scenario completes when it fires. Optional and
   * additive: authors tag the scenario that represents "the learner did it" so
   * the app layer can record progress. The engine only reports it — recording
   * and any telemetry happen outside the engine, keeping it pure.
   */
  completes?: string;
  when: When;
  then: Then;
}

/** Presentation settings (streaming/pacing). Cosmetic only. */
export interface Settings {
  streaming?: boolean;
  streamDelayMs?: number;
  agentThinkMs?: number;
  /**
   * Named pace profiles: a map of profile name → delay in milliseconds. An
   * output entry's `delay` can name one of these instead of a raw number, so a
   * lab tunes its "beats" in one place. Author-declared names override the
   * built-in defaults (see DEFAULT_PACE).
   */
  pace?: Record<string, number>;
}

/** Cross-scenario defaults. */
export interface Defaults {
  unmatched?: Then;
  unmatchedAgent?: Then;
  exit?: number;
}

/** A learner-facing control that writes to the state store when toggled. */
export interface Control {
  id: string;
  label: string;
  description?: string;
  /** Dot-path into the state store that this control modifies. */
  state: string;
  /** Value written when the toggle is enabled. */
  enabled: StateValue;
  /** Value written when the toggle is disabled. */
  disabled: StateValue;
}

export interface Metadata {
  id?: string;
  title?: string;
  summary?: string;
  authors?: string[];
}

/** A parsed simulator.yaml. */
export interface Lab {
  version: string;
  metadata?: Metadata;
  compatibility?: { simulator?: string };
  objectives?: string[];
  state?: Record<string, StateValue>;
  settings?: Settings;
  defaults?: Defaults;
  controls?: Control[];
  workflows?: Workflow[];
  scenarios: Scenario[];
}

/** The outcome of running one command or prompt against a lab. */
export interface Result {
  stdout: RenderedLine[];
  stderr: RenderedLine[];
  exit: number;
  /** Matched scenario ID, "__builtin__" for built-ins, or "" for unmatched default. */
  matched: string;
  /** The step id the matched scenario completes, if it declared `completes:`. */
  completes?: string;
  /** Set when the matched scenario declares a session effect. */
  session?: Session;
  /** Set when the matched scenario declares an interactive input request. */
  input?: InputRequest;
  /**
   * The opening command's captured args, carried alongside `input` so the
   * request's resolution `then` can still read `{{ args.* }}` after the value is
   * collected. Empty for scenarios with no captures.
   */
  inputArgs?: Record<string, string>;
}

/** Resolved presentation options after applying defaults. */
export interface Options {
  stream: boolean;
  delayMs: number;
  thinkMs: number;
}

/** Default streaming options derived from a lab's settings. */
export function resolveOptions(settings: Settings | undefined): Options {
  return {
    stream: settings?.streaming ?? true,
    delayMs: settings?.streamDelayMs ?? 20,
    thinkMs: settings?.agentThinkMs ?? 700,
  };
}

/**
 * Built-in pace profiles, available to every lab without declaration. Authors
 * reference them by name in an output entry's `delay` (e.g. `delay: medium`)
 * and can retune or add profiles via `settings.pace`.
 */
export const DEFAULT_PACE: Record<string, number> = {
  short: 250,
  medium: 700,
  long: 1400,
};

/**
 * resolvePace merges a lab's `settings.pace` over the built-in defaults, giving
 * the full name → milliseconds map the engine uses to resolve `delay` names.
 */
export function resolvePace(
  settings: Settings | undefined,
): Record<string, number> {
  return { ...DEFAULT_PACE, ...(settings?.pace ?? {}) };
}
