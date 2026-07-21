// Minimal {{ }} template substitution for output, file content, and `with`.
// Ported from the Go engine/template.go. Only simple substitution is supported
// (no logic or expressions). See spec/simulator.md §7.4.

import { Store } from "./state";
import { StateValue } from "./types";

// Matches {{ args.name }} / {{ state.dot.path }} placeholders.
const TMPL = /\{\{\s*(args|state)\.([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * render substitutes template placeholders in s using captured args and the
 * (post-delta) state. Unknown placeholders render as an empty string.
 */
export function render(
  s: string,
  args: Record<string, string>,
  st: Store,
): string {
  return s.replace(TMPL, (_match, scope: string, key: string) => {
    if (scope === "args") {
      return args[key] ?? "";
    }
    // scope === "state"
    const { value, present } = st.get(key);
    return present ? formatValue(value) : "";
  });
}

/** renderLines renders each line of a list. */
export function renderLines(
  lines: string[] | undefined,
  args: Record<string, string>,
  st: Store,
): string[] {
  return (lines ?? []).map((l) => render(l, args, st));
}

/**
 * formatValue renders a state value as it should appear in output. Integral
 * numbers print without a decimal point (matching the Go float64 handling).
 */
export function formatValue(v: StateValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
