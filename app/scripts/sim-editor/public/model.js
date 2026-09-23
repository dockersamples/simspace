// The editor's knowledge of the simulator.yaml shapes, as pure functions.
//
// Two rules run through all of it:
//
//   1. EDIT IN PLACE. The model the editor holds is the whole parsed file, and
//      the server diffs it against the file to decide what to rewrite. A form
//      that rebuilt an object from the fields it knows about would silently
//      drop any key it doesn't — so every setter mutates the object it is given
//      and deletes keys rather than replacing their container.
//   2. KEEP THE AUTHOR'S FORM. `command` may be written as a string or a token
//      list, an arg matcher as a scalar or a mapping, an output entry as a bare
//      string or an object. Round-tripping through the UI must not quietly
//      normalize one into the other, because that shows up as a diff.

// ── Small model utilities ────────────────────────────────────────────────────

/** Sets `key` on `obj`, or deletes it when the value is empty. */
export function setOrDelete(obj, key, value) {
  const empty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0);
  if (empty) delete obj[key];
  else obj[key] = value;
}

export function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Ensures `obj[key]` is an object and returns it. */
export function ensureObject(obj, key) {
  if (!isPlainObject(obj[key])) obj[key] = {};
  return obj[key];
}

/** Ensures `obj[key]` is an array and returns it. */
export function ensureArray(obj, key) {
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

/** Reads a `scenarios[3].then.output[1]`-style path out of the model. */
export function getPath(model, path) {
  const parts = String(path ?? "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let node = model;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/** The scenario index a finding's model path belongs to, or -1. */
export function scenarioIndexOf(path) {
  const m = /^scenarios\[(\d+)\]/.exec(String(path ?? ""));
  return m ? Number(m[1]) : -1;
}

export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return;
  const target = Math.max(0, Math.min(list.length - 1, to));
  const [item] = list.splice(from, 1);
  list.splice(target, 0, item);
}

// ── when.command ─────────────────────────────────────────────────────────────

/** The command as one editable line, whichever form the file uses. */
export function commandText(when) {
  const command = when?.command;
  if (Array.isArray(command)) return command.join(" ");
  if (typeof command === "string") return command;
  return "";
}

/**
 * Writes the command back in the form the file already used — a token list
 * stays a list, a string stays a string — so editing one doesn't rewrite the
 * line's style.
 */
export function setCommandText(when, text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    delete when.command;
    return;
  }
  if (typeof when.command === "string" || when.command === undefined) {
    when.command = tokens.join(" ");
    return;
  }
  when.command = tokens;
}

// ── when.args ────────────────────────────────────────────────────────────────

export const MATCHER_KINDS = [
  { kind: "equals", label: "equals", hasValue: true },
  { kind: "any", label: "any value", hasValue: false },
  { kind: "present", label: "is present", hasValue: false },
  { kind: "absent", label: "is absent", hasValue: false },
  { kind: "oneOf", label: "one of", hasValue: true },
];

/** Reads `when.args` into editable rows, mirroring the engine's normalizer. */
export function argRows(when) {
  const args = isPlainObject(when?.args) ? when.args : {};
  return Object.entries(args).map(([name, raw]) => {
    if (typeof raw === "boolean") {
      return { name, kind: raw ? "present" : "absent", value: "" };
    }
    if (isPlainObject(raw)) {
      if (raw.any === true) return { name, kind: "any", value: "" };
      if (Array.isArray(raw.oneOf)) {
        return { name, kind: "oneOf", value: raw.oneOf.join(", ") };
      }
      return { name, kind: "any", value: "" };
    }
    return { name, kind: "equals", value: String(raw ?? "") };
  });
}

/** Writes rows back as the scalar/mapping matcher forms the spec documents. */
export function setArgRows(when, rows) {
  const out = {};
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    switch (row.kind) {
      case "present":
        out[name] = true;
        break;
      case "absent":
        out[name] = false;
        break;
      case "any":
        out[name] = { any: true };
        break;
      case "oneOf":
        out[name] = {
          oneOf: String(row.value ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        };
        break;
      default:
        out[name] = String(row.value ?? "");
    }
  }
  setOrDelete(when, "args", out);
}

/** The capture name a template uses for an arg matcher (dashes stripped). */
export function captureName(name) {
  return /^\d+$/.test(name) ? name : String(name).replace(/^-+/, "");
}

/** Capture names available to `{{ args.* }}` in a scenario's output. */
export function captures(when) {
  return argRows(when)
    .filter(
      (r) => r.kind === "equals" || r.kind === "any" || r.kind === "oneOf",
    )
    .map((r) => captureName(r.name));
}

// ── state maps (when.state, then.state) ─────────────────────────────────────

/** Reads a state map into rows, splitting the `+=` append suffix off the path. */
export function stateRows(map) {
  if (!isPlainObject(map)) return [];
  return Object.entries(map).map(([key, value]) => {
    const append = key.trimEnd().endsWith("+=");
    return {
      path: append ? key.replace(/\+=\s*$/, "").trim() : key.trim(),
      append,
      value: formatValue(value),
    };
  });
}

export function setStateRows(obj, key, rows) {
  const out = {};
  for (const row of rows) {
    const path = String(row.path ?? "").trim();
    if (!path) continue;
    out[row.append ? `${path} +=` : path] = parseValue(row.value);
  }
  setOrDelete(obj, key, out);
}

/** Renders a state value for a text field: YAML-ish, not JSON-quoted. */
export function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Parses a typed state value back. `true`/`false`/`null`/numbers become their
 * types (a lab gating on `docker.running: true` must not get the STRING
 * "true"), a `[…]`/`{…}` literal is read as JSON, everything else stays text.
 */
export function parseValue(text) {
  const raw = String(text ?? "").trim();
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (/^[[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// ── output / stderr entries ─────────────────────────────────────────────────

/** Reads an output list into rows: text, an optional delay, and pure pauses. */
export function outputRows(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return { text: entry, delay: "", pause: false };
    }
    if (!isPlainObject(entry))
      return { text: String(entry ?? ""), delay: "", pause: false };
    const hasText = typeof entry.text === "string";
    return {
      text: hasText ? entry.text : "",
      delay: entry.delay === undefined ? "" : String(entry.delay),
      pause: !hasText,
    };
  });
}

/**
 * Writes one row back in the narrowest form that expresses it: a bare string
 * when there's no delay, `{ text, delay }` when paced, and `{ delay }` alone
 * for a pure pause that prints nothing (spec §7.3).
 */
export function toOutputEntry(row) {
  const delay = String(row.delay ?? "").trim();
  if (row.pause) {
    return { delay: delayValue(delay) };
  }
  if (!delay) return row.text ?? "";
  return { text: row.text ?? "", delay: delayValue(delay) };
}

function delayValue(delay) {
  return /^\d+$/.test(delay) ? Number(delay) : delay;
}

/**
 * Writes the rows back. An empty row is kept, not dropped: a bare `- ""` is a
 * blank line in the output and the sample labs use them. Removing a line is the
 * ✕ button's job, so that adding one and typing into it works the way it looks
 * like it should.
 */
export function setOutputRows(then, key, rows) {
  const entries = rows.map(toOutputEntry);
  if (
    entries.length === 0 &&
    Array.isArray(then[key]) &&
    then[key].length === 0
  ) {
    return; // leave a deliberate `output: []` alone
  }
  setOrDelete(then, key, entries);
}

// ── files operations ────────────────────────────────────────────────────────

export const FILE_VERBS = [
  { verb: "create", label: "create", fields: ["content"] },
  { verb: "append", label: "append to", fields: ["content"] },
  { verb: "replace", label: "replace in", fields: ["find", "with"] },
  { verb: "copy", label: "copy", fields: ["to"] },
  { verb: "mkdir", label: "mkdir", fields: [] },
  { verb: "delete", label: "delete", fields: [] },
];

export function fileOpVerb(op) {
  return FILE_VERBS.find((v) => op?.[v.verb] !== undefined)?.verb ?? "create";
}

/** Switches an operation's verb, keeping the path and dropping stale fields. */
export function setFileOpVerb(op, verb) {
  const current = fileOpVerb(op);
  const path = op[current] ?? "";
  for (const v of FILE_VERBS) delete op[v.verb];
  op[verb] = path;
  const keep = FILE_VERBS.find((v) => v.verb === verb)?.fields ?? [];
  for (const field of ["content", "find", "with", "to"]) {
    if (!keep.includes(field)) delete op[field];
  }
}

// ── templates for new things ────────────────────────────────────────────────

/** A new command scenario, written the way the sample labs write one. */
export function newCommandScenario(id) {
  return {
    id,
    when: { command: "" },
    then: { output: [""] },
  };
}

export function newAgentScenario(id) {
  return {
    id,
    when: { agent: true, promptContains: [] },
    then: { output: [""] },
  };
}

/** A unique id built from a base, e.g. `docker-run-copy`, `docker-run-copy-2`. */
export function uniqueId(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** A deep copy, for duplicating a scenario and for the undo stack. */
export function clone(value) {
  return structuredClone
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

// ── display helpers ─────────────────────────────────────────────────────────

/** Tags a list row shows for a scenario summary. */
export function summaryTags(summary) {
  const tags = [];
  if (summary.kind === "agent") tags.push({ text: "agent", cls: "tag-agent" });
  if (summary.terminal) {
    tags.push({ text: summary.terminal, cls: "tag-terminal" });
  }
  if (summary.requires.length) {
    tags.push({
      text: `needs ${summary.requires.length}`,
      cls: "tag-state",
      title: summary.requires.map(pairLabel).join("\n"),
    });
  }
  if (summary.sets.length) {
    tags.push({
      text: `sets ${summary.sets.length}`,
      cls: "tag-state",
      title: summary.sets.map(pairLabel).join("\n"),
    });
  }
  if (summary.completes) {
    tags.push({ text: `✓ ${summary.completes}`, cls: "tag-completes" });
  }
  for (const effect of summary.effects) {
    if (effect === "state") continue; // already shown as needs/sets
    tags.push({ text: effect, cls: "" });
  }
  if (summary.pacedLines) {
    tags.push({ text: `${summary.pacedLines} paced`, cls: "" });
  }
  return tags;
}

export function pairLabel(pair) {
  return `${pair.path}${pair.append ? " +=" : ":"} ${formatValue(pair.value)}`;
}
