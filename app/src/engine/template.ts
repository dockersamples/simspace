// Minimal {{ }} template substitution for output, file content, and `with`.
// Ported from the Go engine/template.go. Only simple substitution is supported
// (no logic or expressions). See spec/simulator.md §7.4.

import { Store } from "./state";
import { OutputEntry, RenderedLine, StateValue } from "./types";

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

/**
 * renderLines renders each output entry into a RenderedLine: it templates the
 * text and resolves any cosmetic `delay` (a raw millisecond count or a
 * `settings.pace` profile name) into a number. A bare string is a plain line at
 * the default cadence; an object with no `text` becomes a pure pause.
 */
export function renderLines(
  entries: OutputEntry[] | undefined,
  args: Record<string, string>,
  st: Store,
  pace: Record<string, number>,
): RenderedLine[] {
  return (entries ?? []).map((entry) => {
    if (typeof entry === "string") {
      return { text: render(entry, args, st) };
    }
    const delayMs = resolveDelay(entry.delay, pace);
    if (entry.text === undefined || entry.text === null) {
      // No text → a pure pause. Give it an empty string so downstream code that
      // reads `.text` is untouched; the `pause` flag tells the UI to skip it.
      return { text: "", pause: true, delayMs };
    }
    const line: RenderedLine = { text: render(entry.text, args, st) };
    if (delayMs !== undefined) line.delayMs = delayMs;
    return line;
  });
}

/**
 * resolveDelay turns an entry's `delay` into a non-negative millisecond count.
 * A number is used verbatim (clamped at 0); a string is looked up in the pace
 * profile map (unknown names resolve to 0 and are flagged by the validator).
 */
function resolveDelay(
  delay: number | string | undefined,
  pace: Record<string, number>,
): number | undefined {
  if (delay === undefined) return undefined;
  if (typeof delay === "number") return Math.max(0, delay);
  return Math.max(0, pace[delay] ?? 0);
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
