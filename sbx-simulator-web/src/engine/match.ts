// Scenario selection. Matching ANDs a scenario's command path, argument
// matchers, exact prompt, and state preconditions; scenarios are evaluated in
// author order and the first full match wins.

import { Command } from "./commands";
import { Store } from "./state";
import { Lab, Matcher, Scenario, StateValue, When } from "./types";

/** The selected scenario plus arguments captured during matching. */
export interface MatchResult {
  scenario: Scenario;
  args: Record<string, string>;
}

/**
 * match returns the first command scenario whose `when` is fully satisfied, or
 * null if none match. Agent scenarios (when.agent) are never matched here.
 */
export function match(lab: Lab, cmd: Command, st: Store): MatchResult | null {
  for (const scenario of lab.scenarios) {
    if (scenario.when.agent) continue;
    const result = matchWhen(scenario.when, cmd, st);
    if (result.ok) {
      return { scenario, args: result.captures };
    }
  }
  return null;
}

/**
 * matchAgent returns the first agent scenario whose prompt and state conditions
 * match, or null if none match.
 */
export function matchAgent(
  lab: Lab,
  prompt: string,
  st: Store,
): MatchResult | null {
  for (const scenario of lab.scenarios) {
    if (!scenario.when.agent) continue;
    if (matchAgentWhen(scenario.when, prompt, st)) {
      return { scenario, args: {} };
    }
  }
  return null;
}

function matchAgentWhen(w: When, prompt: string, st: Store): boolean {
  if (!promptMatches(w, prompt)) {
    return false;
  }
  return stateMatches(w.state, st);
}

/**
 * promptMatches applies a scenario's prompt matcher. A scenario with neither
 * `prompt` nor `promptContains` matches any prompt (catch-all).
 */
function promptMatches(w: When, prompt: string): boolean {
  const trimmed = prompt.trim();
  if (w.prompt !== undefined) {
    return trimmed === w.prompt.trim();
  }
  if (w.promptContains && w.promptContains.length > 0) {
    const lower = trimmed.toLowerCase();
    return w.promptContains.every((kw) => lower.includes(kw.toLowerCase()));
  }
  return true;
}

function matchWhen(
  w: When,
  cmd: Command,
  st: Store,
): { ok: boolean; captures: Record<string, string> } {
  const fail = { ok: false, captures: {} };

  // 1. Command path must be a prefix of the positional tokens.
  const path = w.command ?? [];
  if (path.length > cmd.tokens.length) {
    return fail;
  }
  for (let i = 0; i < path.length; i++) {
    if (cmd.tokens[i] !== path[i]) {
      return fail;
    }
  }
  const remaining = cmd.tokens.slice(path.length);

  // 2. Exact prompt match against the remaining positionals joined.
  if (w.prompt !== undefined) {
    const got = remaining.join(" ").trim();
    if (got !== w.prompt.trim()) {
      return fail;
    }
  }

  // 3. Argument matchers.
  const captures: Record<string, string> = {};
  for (const [name, m] of Object.entries(w.args ?? {})) {
    const { value, present } = resolveArg(name, cmd, remaining);
    const { ok, capture } = evalMatcher(m, value, present);
    if (!ok) {
      return fail;
    }
    if (capture) {
      captures[name] = value;
    }
  }

  // 4. State preconditions.
  if (!stateMatches(w.state, st)) {
    return fail;
  }

  return { ok: true, captures };
}

/**
 * resolveArg looks up an argument by name. An integer name indexes the
 * positional args remaining after the command path; any other name is a flag.
 */
function resolveArg(
  name: string,
  cmd: Command,
  remaining: string[],
): { value: string; present: boolean } {
  if (/^\d+$/.test(name)) {
    const idx = Number(name);
    if (idx < remaining.length) {
      return { value: remaining[idx], present: true };
    }
    return { value: "", present: false };
  }
  if (name in cmd.flags) {
    return { value: cmd.flags[name], present: true };
  }
  return { value: "", present: false };
}

function evalMatcher(
  m: Matcher,
  value: string,
  present: boolean,
): { ok: boolean; capture: boolean } {
  switch (m.kind) {
    case "equals":
      return { ok: present && value === m.value, capture: true };
    case "present":
      return { ok: present, capture: false };
    case "absent":
      return { ok: !present, capture: false };
    case "any":
      return { ok: present, capture: true };
    case "oneOf":
      if (!present) return { ok: false, capture: false };
      return { ok: (m.oneOf ?? []).includes(value), capture: true };
    default:
      return { ok: false, capture: false };
  }
}

function stateMatches(
  conds: Record<string, StateValue> | undefined,
  st: Store,
): boolean {
  for (const [path, expected] of Object.entries(conds ?? {})) {
    const { value, present } = st.get(path);
    if (!stateEqual(expected, value, present)) {
      return false;
    }
  }
  return true;
}

/**
 * stateEqual compares an expected precondition against the actual state value.
 * A missing key is treated as its zero value, so `running: false` matches both
 * an explicit false and an unset key (§6.4).
 */
function stateEqual(
  expected: StateValue,
  actual: StateValue | undefined,
  present: boolean,
): boolean {
  if (!present) {
    return isZero(expected);
  }
  return jsonEqual(expected, actual);
}

function isZero(v: StateValue): boolean {
  if (v === null) return true;
  if (typeof v === "boolean") return !v;
  if (typeof v === "string") return v === "";
  if (typeof v === "number") return v === 0;
  return false;
}

/** jsonEqual compares two values by their JSON encoding. */
function jsonEqual(a: StateValue, b: StateValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
