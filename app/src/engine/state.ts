// In-memory, dot-path runtime state store, ported from the Go state package.
//
// The original CLI ran a fresh process per command, so state was persisted to
// state.json between invocations. In the browser the terminal component keeps a
// single Store alive across commands; "reset" re-seeds from the manifest, just
// like clearing that on-disk state. See spec/simulator.md §2.

import { StateValue } from "./types";

/** The reserved dot-path holding the append-only command history. */
export const HistoryKey = "history";

type StateObject = { [key: string]: StateValue };

export class Store {
  private data: StateObject;

  private constructor(data: StateObject) {
    this.data = data;
  }

  /**
   * seed creates a fresh store from the manifest's `state:` block. The seed is
   * deep-copied so mutations never leak back into the parsed Lab.
   */
  static seed(seed: Record<string, StateValue> | undefined): Store {
    return new Store(deepCopy(seed ?? {}) as StateObject);
  }

  /**
   * restore creates a store from previously persisted data (e.g. localStorage),
   * deep-copied so external mutations cannot affect the store.
   */
  static restore(data: Record<string, StateValue>): Store {
    return new Store(deepCopy(data ?? {}) as StateObject);
  }

  /**
   * Get resolves a dot-path. present is false if any segment is missing or the
   * path traverses through a non-object.
   */
  get(path: string): { value: StateValue | undefined; present: boolean } {
    const segs = splitPath(path);
    if (segs.length === 0) {
      return { value: undefined, present: false };
    }
    let cur: StateValue = this.data;
    for (const seg of segs) {
      if (!isObject(cur)) {
        return { value: undefined, present: false };
      }
      if (!(seg in cur)) {
        return { value: undefined, present: false };
      }
      cur = cur[seg];
    }
    return { value: cur, present: true };
  }

  /**
   * set writes value at a dot-path, creating intermediate objects as needed. A
   * non-object encountered mid-path is replaced by a fresh object.
   */
  set(path: string, value: StateValue): void {
    const segs = splitPath(path);
    if (segs.length === 0) {
      return;
    }
    let m = this.data;
    for (const seg of segs.slice(0, -1)) {
      const next = m[seg];
      if (!isObject(next)) {
        const fresh: StateObject = {};
        m[seg] = fresh;
        m = fresh;
      } else {
        m = next;
      }
    }
    m[segs[segs.length - 1]] = value;
  }

  /**
   * append pushes value onto the list at a dot-path, creating the list (and any
   * intermediate objects) if absent. An existing non-list value is replaced by
   * a new single-element list.
   */
  append(path: string, value: StateValue): void {
    const { value: existing, present } = this.get(path);
    if (!present || !Array.isArray(existing)) {
      this.set(path, [value]);
      return;
    }
    this.set(path, [...existing, value]);
  }

  /** appendHistory records a raw command line in the reserved history list. */
  appendHistory(line: string): void {
    this.append(HistoryKey, line);
  }

  /** snapshot returns a deep copy of the state tree for inspection. */
  snapshot(): StateObject {
    return deepCopy(this.data) as StateObject;
  }
}

function isObject(v: StateValue | undefined): v is StateObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function splitPath(path: string): string[] {
  if (!path) {
    return [];
  }
  return path.split(".").filter((p) => p.length > 0);
}

function deepCopy(v: StateValue): StateValue {
  if (Array.isArray(v)) {
    return v.map(deepCopy);
  }
  if (v !== null && typeof v === "object") {
    const out: StateObject = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = deepCopy(val);
    }
    return out;
  }
  return v;
}
