// Parses a simulator YAML document into a typed Lab. It normalizes the two
// flexible YAML forms — the scalar-or-sequence `command` path and the
// scalar-or-mapping arg `Matcher` — into the canonical shapes the engine
// matches against.

import { parse as parseYaml } from "yaml";
import {
  Control,
  Lab,
  Matcher,
  SchemaVersion,
  Scenario,
  StateValue,
  When,
} from "./types";

/** Raised for malformed manifests, analogous to the Go parse/validate errors. */
export class ManifestError extends Error {}

/**
 * Parse decodes sbx-simulator.yaml text into a Lab, normalizing the flexible
 * matcher forms. It throws ManifestError on structural problems.
 */
export function parseManifest(text: string): Lab {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ManifestError(`parse lab: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== "object") {
    throw new ManifestError("parse lab: manifest is empty or not a mapping");
  }

  const doc = raw as Record<string, unknown>;
  const version = typeof doc.version === "string" ? doc.version : "";

  const scenariosRaw = doc.scenarios;
  if (!Array.isArray(scenariosRaw)) {
    throw new ManifestError("parse lab: `scenarios` must be a list");
  }

  const scenarios = scenariosRaw.map((s, i) => normalizeScenario(s, i));

  return {
    version,
    metadata: doc.metadata as Lab["metadata"],
    compatibility: doc.compatibility as Lab["compatibility"],
    objectives: doc.objectives as string[] | undefined,
    state: doc.state as Record<string, StateValue> | undefined,
    settings: doc.settings as Lab["settings"],
    defaults: doc.defaults as Lab["defaults"],
    controls: doc.controls !== undefined ? parseControls(doc.controls) : undefined,
    scenarios,
  };
}

/**
 * checkSchemaVersion reports whether a lab's declared schema version is
 * compatible with this build. Any 2.x manifest is accepted (major must match).
 */
export function checkSchemaVersion(v: string): void {
  if (!v) {
    throw new ManifestError("simulator.yaml is missing a `version` field");
  }
  const major = v.split(".")[0];
  const want = SchemaVersion.split(".")[0];
  if (major !== want) {
    throw new ManifestError(
      `lab schema version "${v}" is incompatible with simulator schema "${SchemaVersion}"`,
    );
  }
}

function normalizeScenario(raw: unknown, index: number): Scenario {
  if (raw === null || typeof raw !== "object") {
    throw new ManifestError(`scenario #${index} must be a mapping`);
  }
  const s = raw as Record<string, unknown>;
  const id = typeof s.id === "string" ? s.id : `scenario-${index}`;
  return {
    id,
    description: typeof s.description === "string" ? s.description : undefined,
    when: normalizeWhen(s.when, id),
    then: (s.then as Scenario["then"]) ?? {},
  };
}

function normalizeWhen(raw: unknown, id: string): When {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== "object") {
    throw new ManifestError(`scenario "${id}": \`when\` must be a mapping`);
  }
  const w = raw as Record<string, unknown>;

  const when: When = {};
  if (w.command !== undefined) {
    when.command = normalizeCommandPath(w.command, id);
  }
  if (w.args !== undefined) {
    when.args = normalizeArgs(w.args, id);
  }
  if (w.agent !== undefined) {
    when.agent = Boolean(w.agent);
  }
  if (w.prompt !== undefined) {
    when.prompt = String(w.prompt);
  }
  if (w.promptContains !== undefined) {
    when.promptContains = (w.promptContains as unknown[]).map(String);
  }
  if (w.state !== undefined) {
    when.state = w.state as Record<string, StateValue>;
  }
  return when;
}

/**
 * normalizeCommandPath accepts a space-joined scalar ("policy allow network")
 * or a sequence ([policy, allow, network]); both become the same token list.
 */
function normalizeCommandPath(raw: unknown, id: string): string[] {
  if (typeof raw === "string") {
    return raw.split(/\s+/).filter((t) => t.length > 0);
  }
  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  throw new ManifestError(
    `scenario "${id}": \`command\` must be a string or list`,
  );
}

function normalizeArgs(raw: unknown, id: string): Record<string, Matcher> {
  if (raw === null || typeof raw !== "object") {
    throw new ManifestError(`scenario "${id}": \`args\` must be a mapping`);
  }
  const out: Record<string, Matcher> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = normalizeMatcher(value, id, name);
  }
  return out;
}

/**
 * normalizeMatcher decodes the scalar and mapping matcher forms:
 *   name: "web"           -> equals
 *   publish: true         -> present
 *   detach: false         -> absent
 *   region: { any: true } -> any
 *   count: { oneOf: [..] }-> oneOf
 */
function normalizeMatcher(raw: unknown, id: string, name: string): Matcher {
  if (typeof raw === "boolean") {
    return { kind: raw ? "present" : "absent" };
  }
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "bigint"
  ) {
    return { kind: "equals", value: String(raw) };
  }
  if (raw !== null && typeof raw === "object") {
    const obj = raw as { any?: unknown; oneOf?: unknown };
    if (obj.any === true) {
      return { kind: "any" };
    }
    if (Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
      return { kind: "oneOf", oneOf: obj.oneOf.map(String) };
    }
    throw new ManifestError(
      `scenario "${id}" arg "${name}": matcher must set \`any: true\` or a non-empty \`oneOf\``,
    );
  }
  throw new ManifestError(
    `scenario "${id}" arg "${name}": matcher must be a scalar or mapping`,
  );
}

function parseControls(raw: unknown): Control[] {
  if (!Array.isArray(raw)) {
    throw new ManifestError("`controls` must be a list");
  }
  return raw.map((c, i) => parseControl(c, i));
}

function parseControl(raw: unknown, index: number): Control {
  if (raw === null || typeof raw !== "object") {
    throw new ManifestError(`control #${index} must be a mapping`);
  }
  const c = raw as Record<string, unknown>;
  const id =
    typeof c.id === "string" && c.id
      ? c.id
      : `control-${index}`;
  const label = typeof c.label === "string" ? c.label : "";
  if (!label) {
    throw new ManifestError(`control "${id}": \`label\` is required`);
  }
  const statePath = typeof c.state === "string" ? c.state : "";
  if (!statePath) {
    throw new ManifestError(`control "${id}": \`state\` is required`);
  }
  return {
    id,
    label,
    description: typeof c.description === "string" ? c.description : undefined,
    state: statePath,
    enabled: c.enabled !== undefined ? (c.enabled as StateValue) : true,
    disabled: c.disabled !== undefined ? (c.disabled as StateValue) : false,
  };
}
