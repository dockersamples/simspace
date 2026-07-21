// Applies a scenario's effects in the fixed order files -> state ->
// output/stderr -> mcp, returning the collected stdout/stderr lines. Ported
// from engine/apply.go. See spec/simulator.md §7.

import { FS } from "./filesystem";
import { Store } from "./state";
import { render, renderLines } from "./template";
import { renderMCP } from "./mcp";
import { FileOp, StateValue, Then } from "./types";

/** Marks a state delta key as a list append (§7.2). */
const APPEND_SUFFIX = "+=";

export interface ApplyOutput {
  stdout: string[];
  stderr: string[];
}

/**
 * applyThen applies a scenario's effects and returns the collected output.
 * Exit is resolved by the caller (which layers in defaults).
 */
export function applyThen(
  then: Then,
  fs: FS,
  st: Store,
  args: Record<string, string>,
): ApplyOutput {
  // 1. Files (before state, so file content sees captured args).
  for (const op of then.files ?? []) {
    applyFileOp(op, fs, st, args);
  }

  // 2. State deltas (sorted for deterministic application; string values are
  //    templated against args + state applied so far).
  const state = then.state ?? {};
  for (const key of Object.keys(state).sort()) {
    const value = renderStateValue(state[key], args, st);
    if (key.endsWith(APPEND_SUFFIX)) {
      st.append(key.slice(0, -APPEND_SUFFIX.length).trim(), value);
    } else {
      st.set(key, value);
    }
  }

  // 3. Output / stderr (rendered against args + post-delta state).
  const stdout = renderLines(then.output, args, st);
  const stderr = renderLines(then.stderr, args, st);

  // 4. MCP output appended to stdout.
  for (const call of then.mcp ?? []) {
    stdout.push(...renderMCP(call));
  }

  return { stdout, stderr };
}

/** applyFileOp dispatches a single file operation. Exactly one verb is set. */
function applyFileOp(
  op: FileOp,
  fs: FS,
  st: Store,
  args: Record<string, string>,
): void {
  const content = render(op.content ?? "", args, st);
  const withVal = render(op.with ?? "", args, st);

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
): StateValue {
  return typeof v === "string" ? render(v, args, st) : v;
}
