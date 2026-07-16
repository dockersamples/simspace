// Type definitions for the SBX Simulator lab manifest and engine, ported from
// the Go implementation's manifest package. See sbx-simulator/docs/scenario-spec.md.

/** SchemaVersion is the scenario schema version this build understands. */
export const SchemaVersion = "1.1";

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
  /** Subcommand token path after `sbx`. Always normalized to a token list. */
  command?: string[];
  args?: Record<string, Matcher>;
  agent?: boolean;
  prompt?: string;
  promptContains?: string[];
  state?: Record<string, StateValue>;
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

/** A mocked MCP tool invocation rendered as sbx-style output. */
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

/** Then holds the effects applied when a scenario fires. */
export interface Then {
  files?: FileOp[];
  state?: Record<string, StateValue>;
  output?: string[];
  stderr?: string[];
  exit?: number;
  mcp?: MCPCall[];
  session?: Session;
}

/** Scenario is one ordered match rule. */
export interface Scenario {
  id: string;
  description?: string;
  when: When;
  then: Then;
}

/** Presentation settings (streaming/pacing). Cosmetic only. */
export interface Settings {
  streaming?: boolean;
  streamDelayMs?: number;
  agentThinkMs?: number;
}

/** Cross-scenario defaults. */
export interface Defaults {
  unmatched?: Then;
  unmatchedAgent?: Then;
  exit?: number;
}

export interface Metadata {
  id?: string;
  title?: string;
  summary?: string;
  authors?: string[];
}

/** A parsed sbx-simulator.yaml. */
export interface Lab {
  version: string;
  metadata?: Metadata;
  compatibility?: { simulator?: string };
  objectives?: string[];
  state?: Record<string, StateValue>;
  settings?: Settings;
  defaults?: Defaults;
  scenarios: Scenario[];
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
