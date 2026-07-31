// Applies a scenario's effects in the fixed order files -> state ->
// output/stderr -> mcp, returning the collected stdout/stderr lines. Ported
// from engine/apply.go. See spec/simulator.md §7.

import { ciRunToState, resolveCIRun } from "./ci";
import { FS } from "./filesystem";
import { Store } from "./state";
import { render, renderLines } from "./template";
import { renderMCP } from "./mcp";
import { FileOp, RenderedLine, StateValue, Then, Workflow } from "./types";

/** The state path holding the append-only list of CI run records. */
const CI_RUNS_KEY = "ci.runs";

/** Marks a state delta key as a list append (§7.2). */
const APPEND_SUFFIX = "+=";

export interface ApplyOutput {
  stdout: RenderedLine[];
  stderr: RenderedLine[];
}

/**
 * applyThen applies a scenario's effects and returns the collected output.
 * Exit is resolved by the caller (which layers in defaults). `pace` is the
 * resolved pace-profile map used to turn output `delay` names into numbers.
 */
export function applyThen(
  then: Then,
  fs: FS,
  st: Store,
  args: Record<string, string>,
  workflows?: Workflow[],
  pace: Record<string, number> = {},
  input: Record<string, string> = {},
): ApplyOutput {
  // 1. Files (before state, so file content sees captured args).
  for (const op of then.files ?? []) {
    applyFileOp(op, fs, st, args, input);
  }

  // 2. State deltas (sorted for deterministic application; string values are
  //    templated against args + state applied so far).
  const state = then.state ?? {};
  for (const key of Object.keys(state).sort()) {
    const value = renderStateValue(state[key], args, st, input);
    if (key.endsWith(APPEND_SUFFIX)) {
      st.append(key.slice(0, -APPEND_SUFFIX.length).trim(), value);
    } else {
      st.set(key, value);
    }
  }

  // 2b. CI trigger: resolve the referenced workflow into a complete run record
  //     and append it to the shared run list. The run id is the new length, so
  //     runs number 1, 2, 3, … deterministically.
  if (then.ci) {
    const existing = st.get(CI_RUNS_KEY).value;
    const count = Array.isArray(existing) ? existing.length : 0;
    const run = resolveCIRun(then.ci, workflows, count + 1, (path) => {
      const { value, present } = st.get(path);
      return present ? (value ?? null) : null;
    });
    st.append(CI_RUNS_KEY, ciRunToState(run));
  }

  // 3. Output / stderr (rendered against args + post-delta state + input).
  const stdout = renderLines(then.output, args, st, pace, input);
  const stderr = renderLines(then.stderr, args, st, pace, input);

  // 4. MCP output appended to stdout (always at the default cadence).
  for (const call of then.mcp ?? []) {
    stdout.push(...renderMCP(call).map((text) => ({ text })));
  }

  return { stdout, stderr };
}

/** applyFileOp dispatches a single file operation. Exactly one verb is set. */
function applyFileOp(
  op: FileOp,
  fs: FS,
  st: Store,
  args: Record<string, string>,
  input: Record<string, string> = {},
): void {
  const content = render(op.content ?? "", args, st, input);
  const withVal = render(op.with ?? "", args, st, input);

  if (op.mkdir) return fs.mkdir(op.mkdir);
  if (op.create) return fs.create(op.create, content);
  if (op.append) return fs.append(op.append, content);
  if (op.replace) return fs.replace(op.replace, op.find ?? "", withVal);
  if (op.delete) return fs.delete(op.delete);
  if (op.copy) return fs.copy(op.copy, op.to ?? "");
  throw new Error("file op has no recognized verb");
}

/** renderStateValue templates string state values; other types pass through. */
function renderStateValue(
  v: StateValue,
  args: Record<string, string>,
  st: Store,
  input: Record<string, string> = {},
): StateValue {
  return typeof v === "string" ? render(v, args, st, input) : v;
}
