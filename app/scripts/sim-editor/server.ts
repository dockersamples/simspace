// sim-editor: a local editor for a simulator.yaml state machine.
//
//   npm run edit-sim                       # every spec under public/labs
//   npm run edit-sim -- public/labs/tour-of-docker/simulator.yaml
//   npm run edit-sim -- --port 5180
//
// A stdlib HTTP server serving a dependency-free browser UI plus a JSON API. It
// lives in `scripts/` rather than in the app because `app/` is the product: a
// static site with no backend, and an editor has to write files. See PLAN.md.
//
// Everything it says about matching, output, and state comes from the REAL
// engine (`@dockersamples/simspace-simulator`), so the editor and the learner's
// terminal cannot disagree. Writes go through patch.ts, which changes only the
// bytes you edited, and never writes a file whose meaning it didn't intend.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import {
  Simulator,
  StateValue,
  parseManifest,
} from "@dockersamples/simspace-simulator";
import { analyze, scenarioComments } from "./analyze";
import { discover, SpecEntry } from "./discover";
import { lint } from "./lint";
import { Json, patchYaml } from "./patch";

// ── CLI ──────────────────────────────────────────────────────────────────────

interface Options {
  target: string;
  port: number;
  host: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    target: "public/labs",
    port: 5174,
    host: "0.0.0.0",
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") opts.port = Number(argv[++i]);
    else if (arg === "--host") opts.host = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npm run edit-sim -- [file-or-dir] [--port N] [--host H]",
          "",
          "  file-or-dir   a simulator.yaml, a lab directory, or a labs directory",
          "                (default: public/labs)",
          "  --port        port to listen on (default 5174)",
          "  --host        interface to bind (default 0.0.0.0)",
        ].join("\n"),
      );
      process.exit(0);
    } else rest.push(arg);
  }
  if (rest.length) opts.target = rest[0];
  return opts;
}

// ── Open documents ───────────────────────────────────────────────────────────

/**
 * A console session: a live Simulator per open spec, so consecutive commands
 * accumulate the way they do for a learner. Editing the spec rebuilds the
 * engine but RESTORES the state and filesystem, so fixing a typo mid-playthrough
 * doesn't throw the playthrough away.
 */
interface Session {
  state: Record<string, StateValue>;
  files: Record<string, string>;
  history: string[];
}

const sessions = new Map<string, Session>();

interface DocView {
  path: string;
  relPath: string;
  text: string;
  model: Json;
  mtimeMs: number;
  entry: SpecEntry;
  /** Null when the spec doesn't parse; the UI then offers the raw editor. */
  analysis: ReturnType<typeof analyze> | null;
  findings: ReturnType<typeof lint>;
  comments: ReturnType<typeof scenarioComments>;
  parseError?: string;
}

function readDoc(entry: SpecEntry): DocView {
  const text = readFileSync(entry.path, "utf8");
  const mtimeMs = statSync(entry.path).mtimeMs;
  const view: DocView = {
    path: entry.path,
    relPath: entry.relPath,
    text,
    model: null,
    mtimeMs,
    entry,
    analysis: null,
    findings: [],
    comments: scenarioComments(text.split("\n")),
  };

  try {
    view.model = parseYamlModel(text);
  } catch (e) {
    view.parseError = (e as Error).message;
    return view;
  }

  try {
    const lab = parseManifest(text);
    const analysis = analyze(lab);
    view.analysis = analysis;
    view.findings = lint(lab, {
      analysis,
      terminalIds: entry.terminalIds.length ? entry.terminalIds : undefined,
      stepIds: entry.labIds.length ? entry.stepIds : undefined,
      shared: entry.shared,
    });
  } catch (e) {
    view.parseError = (e as Error).message;
  }
  return view;
}

function parseYamlModel(text: string): Json {
  const model = parseYaml(text);
  if (model === null || typeof model !== "object") {
    throw new Error("simulator.yaml is empty or not a mapping");
  }
  return model as Json;
}

// ── Saving ───────────────────────────────────────────────────────────────────

const BACKUP_DIR = join(tmpdir(), "simspace-sim-editor");

/**
 * save writes the edited model back through the patcher. Three guards, in
 * order, because this is the part that can lose someone's work:
 *
 *   1. the file must not have changed on disk since the editor read it (an
 *      agent or an editor elsewhere may have touched it);
 *   2. the previous contents are copied into the OS temp dir first, so there is
 *      an undo outside the editor even if the repo isn't committed;
 *   3. the new text is written to a temp file and renamed, so a crash can't
 *      leave a half-written spec.
 */
function save(
  entry: SpecEntry,
  model: Json,
  expectedMtimeMs: number | undefined,
):
  | {
      ok: true;
      strategy: string;
      changes: unknown[];
      backup: string | null;
      doc: DocView;
    }
  | { ok: false; reason: "stale"; doc: DocView } {
  const current = readFileSync(entry.path, "utf8");
  const mtimeMs = statSync(entry.path).mtimeMs;
  if (
    expectedMtimeMs !== undefined &&
    Math.abs(mtimeMs - expectedMtimeMs) > 1
  ) {
    return { ok: false, reason: "stale", doc: readDoc(entry) };
  }

  const result = patchYaml(current, model, {
    debug: (message) => console.log(`  [patch] ${message}`),
  });

  if (result.strategy === "unchanged") {
    return {
      ok: true,
      strategy: result.strategy,
      changes: [],
      backup: null,
      doc: readDoc(entry),
    };
  }

  let backup: string | null = null;
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = String(mtimeMs).replace(/\D/g, "");
    backup = join(
      BACKUP_DIR,
      `${entry.labIds[0] ?? "spec"}-${stamp}-simulator.yaml`,
    );
    copyFileSync(entry.path, backup);
  } catch {
    backup = null; // a missing backup must not block the save
  }

  const tmp = `${entry.path}.sim-editor.tmp`;
  writeFileSync(tmp, result.text, "utf8");
  renameSync(tmp, entry.path);

  return {
    ok: true,
    strategy: result.strategy,
    changes: result.changes,
    backup,
    doc: readDoc(entry),
  };
}

// ── The console: running commands against the edited model ───────────────────

interface RunRequest {
  path: string;
  model: Json;
  /** "command" runs a shell line, "prompt" an agent turn. */
  mode?: "command" | "prompt";
  line: string;
  terminal?: string;
  /** Start from the lab's seed state instead of the session's current state. */
  fresh?: boolean;
}

function runCommand(entry: SpecEntry, req: RunRequest) {
  const spec = stringify(req.model);
  const session = sessions.get(entry.path);
  const restore = req.fresh ? undefined : session;

  const sim = new Simulator({
    spec,
    files: entry.files,
    ...(restore
      ? { restoredState: restore.state, restoredFiles: restore.files }
      : {}),
  });

  const before = sim.state();
  const outcome =
    req.mode === "prompt"
      ? sim.prompt(req.line, req.terminal)
      : sim.execute(req.line, req.terminal);
  const after = sim.state();

  const history = [...(restore?.history ?? []), req.line];
  sessions.set(entry.path, {
    state: after as Record<string, StateValue>,
    files: sim.files(),
    history,
  });

  return {
    line: req.line,
    mode: req.mode ?? "command",
    matched: outcome.matched,
    exit: outcome.exit,
    completes: (outcome as { completes?: string }).completes,
    session: (outcome as { session?: unknown }).session,
    input: (outcome as { input?: unknown }).input,
    lines: outcome.lines,
    changed: reportableChanges(stateDiff(before, after)),
    state: after,
    files: sim.files(),
    history,
  };
}

function resetSession(entry: SpecEntry, model: Json) {
  const sim = new Simulator({ spec: stringify(model), files: entry.files });
  sessions.delete(entry.path);
  return { state: sim.state(), files: sim.files(), history: [] as string[] };
}

function setControlValue(
  entry: SpecEntry,
  model: Json,
  path: string,
  value: StateValue,
) {
  const session = sessions.get(entry.path);
  const sim = new Simulator({
    spec: stringify(model),
    files: entry.files,
    ...(session
      ? { restoredState: session.state, restoredFiles: session.files }
      : {}),
  });
  sim.setControl(path, value);
  sessions.set(entry.path, {
    state: sim.state() as Record<string, StateValue>,
    files: sim.files(),
    history: session?.history ?? [],
  });
  return { state: sim.state(), files: sim.files() };
}

/**
 * Trims the state diff to what an author wants to read. `history` changes on
 * every single command (the engine appends to it), and a CI run record is a
 * whole nested object — so the first is dropped and the second is reported as a
 * count rather than as a page of JSON.
 */
function reportableChanges(changes: StateChange[]): StateChange[] {
  const out: StateChange[] = [];
  for (const change of changes) {
    if (change.path === "history") continue;
    if (change.path === "ci.runs") {
      out.push({
        path: "ci.runs",
        before: count(change.before),
        after: count(change.after),
      });
      continue;
    }
    out.push(change);
  }
  return out;
}

function count(value: StateValue | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

export interface StateChange {
  path: string;
  before: StateValue | undefined;
  after: StateValue | undefined;
}

/** stateDiff reports the dot-paths whose values differ between two snapshots. */
export function stateDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): StateChange[] {
  const flat = (
    obj: unknown,
    prefix = "",
    out = new Map<string, unknown>(),
  ) => {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        flat(value, prefix ? `${prefix}.${key}` : key, out);
      }
      if (prefix) out.set(prefix, obj);
      return out;
    }
    if (prefix) out.set(prefix, obj);
    return out;
  };

  const a = flat(before);
  const b = flat(after);
  const paths = new Set([...a.keys(), ...b.keys()]);
  const changes: StateChange[] = [];
  for (const path of [...paths].sort()) {
    const x = a.get(path);
    const y = b.get(path);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    // Skip container objects whose children already report the change.
    if (
      x &&
      typeof x === "object" &&
      !Array.isArray(x) &&
      y &&
      typeof y === "object" &&
      !Array.isArray(y)
    ) {
      continue;
    }
    changes.push({
      path,
      before: x as StateValue | undefined,
      after: y as StateValue | undefined,
    });
  }
  return changes;
}

// ── validate-lab, the authoritative check ────────────────────────────────────

/**
 * validateLab shells out to the real validator rather than reimplementing it.
 * It also regenerates `labs.json`, which is generated and git-ignored anyway.
 */
function validateLab(
  labsDir: string,
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [
        join(APP_DIR, "scripts/run-ts.mjs"),
        join(APP_DIR, "scripts/validate-lab.ts"),
        labsDir,
      ],
      { cwd: APP_DIR },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => done({ code: code ?? 0, output }));
    child.on("error", (e) => done({ code: -1, output: String(e) }));
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

// run-ts.mjs bundles this file into a temp directory, so `import.meta.url` is
// useless for locating our own static assets. It re-points argv[1] at the real
// entry, which is what we resolve from.
const HERE = dirname(
  resolve(process.argv[1] ?? "scripts/sim-editor/server.ts"),
);
const PUBLIC_DIR = join(HERE, "public");
const APP_DIR = resolve(HERE, "../..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const opts = parseArgs(process.argv.slice(2));

const specs: SpecEntry[] = (() => {
  try {
    return discover(opts.target);
  } catch (e) {
    console.error(`sim-editor: ${(e as Error).message}`);
    process.exit(1);
    throw e; // unreachable; keeps the type honest without @types/node
  }
})();
if (specs.length === 0) {
  console.error(
    `sim-editor: no simulator.yaml found under ${opts.target}\n` +
      "Point it at a lab directory or a simulator.yaml.",
  );
  process.exit(1);
}

function entryFor(path: string): SpecEntry | undefined {
  const abs = resolve(path);
  return specs.find((s) => s.path === abs);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

async function api(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const route = url.pathname.slice("/api/".length);

  if (route === "files") {
    json(res, 200, {
      files: specs.map((s) => ({
        path: s.path,
        relPath: s.relPath,
        title: s.title,
        labIds: s.labIds,
        shared: s.shared,
      })),
    });
    return;
  }

  if (route === "doc") {
    const entry = entryFor(url.searchParams.get("path") ?? "");
    if (!entry) return json(res, 404, { error: "unknown spec path" });
    json(res, 200, docPayload(readDoc(entry)));
    return;
  }

  const body = await readBody(req);

  if (route === "analyze") {
    const entry = entryFor(String(body.path ?? ""));
    if (!entry) return json(res, 404, { error: "unknown spec path" });
    try {
      json(res, 200, analyzeModel(entry, body.model as Json));
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
    return;
  }

  if (route === "preview" || route === "save") {
    const entry = entryFor(String(body.path ?? ""));
    if (!entry) return json(res, 404, { error: "unknown spec path" });
    const model = body.model as Json;

    if (route === "preview") {
      const current = readFileSync(entry.path, "utf8");
      const result = patchYaml(current, model);
      json(res, 200, {
        strategy: result.strategy,
        changes: result.changes,
        diff: unifiedDiff(current, result.text),
      });
      return;
    }

    const outcome = save(entry, model, body.mtimeMs as number | undefined);
    if (!outcome.ok) {
      json(res, 409, {
        error: "the file changed on disk since you opened it",
        doc: docPayload(outcome.doc),
      });
      return;
    }
    console.log(
      `  saved ${entry.relPath} (${outcome.strategy}, ${outcome.changes.length} change(s))`,
    );
    json(res, 200, {
      strategy: outcome.strategy,
      changes: outcome.changes,
      backup: outcome.backup,
      doc: docPayload(outcome.doc),
    });
    return;
  }

  if (route === "run" || route === "reset" || route === "control") {
    const entry = entryFor(String(body.path ?? ""));
    if (!entry) return json(res, 404, { error: "unknown spec path" });
    try {
      if (route === "reset") {
        json(res, 200, resetSession(entry, body.model as Json));
      } else if (route === "control") {
        json(
          res,
          200,
          setControlValue(
            entry,
            body.model as Json,
            String(body.statePath),
            body.value as StateValue,
          ),
        );
      } else {
        json(res, 200, runCommand(entry, body as unknown as RunRequest));
      }
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
    return;
  }

  if (route === "validate-lab") {
    const entry = entryFor(String(body.path ?? ""));
    if (!entry) return json(res, 404, { error: "unknown spec path" });
    const labsDir = dirname(dirname(entry.path));
    const result = await validateLab(labsDir);
    json(res, 200, result);
    return;
  }

  json(res, 404, { error: `unknown endpoint /api/${route}` });
}

/**
 * analyzeModel runs the engine's parser over the EDITED model rather than the
 * file, so the list tags, the pre/post card and the checks describe what the
 * author has now. It goes through `stringify` + `parseManifest` on purpose:
 * anything the engine would reject at load time is reported here, at the
 * keystroke that caused it, rather than after a save.
 */
function analyzeModel(entry: SpecEntry, model: Json) {
  const lab = parseManifest(stringify(model));
  const analysis = analyze(lab);
  return {
    analysis,
    findings: lint(lab, {
      analysis,
      terminalIds: entry.terminalIds.length ? entry.terminalIds : undefined,
      stepIds: entry.labIds.length ? entry.stepIds : undefined,
      shared: entry.shared,
    }),
  };
}

function docPayload(doc: DocView) {
  return {
    path: doc.path,
    relPath: doc.relPath,
    text: doc.text,
    model: doc.model,
    mtimeMs: doc.mtimeMs,
    analysis: doc.analysis,
    findings: doc.findings,
    comments: doc.comments,
    parseError: doc.parseError,
    context: {
      labIds: doc.entry.labIds,
      title: doc.entry.title,
      shared: doc.entry.shared,
      terminalIds: doc.entry.terminalIds,
      stepIds: doc.entry.stepIds,
      files: Object.keys(doc.entry.files),
    },
    session: sessions.get(doc.path) ?? null,
  };
}

/**
 * The browser UI needs a YAML parser for its raw-edit panels. Rather than
 * vendoring one, serve the app's own `yaml` dependency: the package ships an
 * ESM browser build, so the editor and the engine read YAML the same way, and
 * there is nothing to keep in sync.
 */
const YAML_DIR = findYamlBrowserDist();

function findYamlBrowserDist(): string | null {
  let dir = APP_DIR;
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, "node_modules/yaml/browser/dist");
    if (existsSync(join(candidate, "index.js"))) return candidate;
    dir = dirname(dir);
  }
  return null;
}

function serveStatic(pathname: string, res: ServerResponse): void {
  if (pathname.startsWith("/vendor/yaml/")) {
    if (!YAML_DIR) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("// the `yaml` package was not found — run npm install");
      return;
    }
    const rel = normalize(pathname.slice("/vendor/yaml/".length)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    const file = join(YAML_DIR, rel);
    if (!file.startsWith(YAML_DIR) || !existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[".js"],
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(file));
    return;
  }

  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = join(PUBLIC_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(file));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * unifiedDiff renders the save preview. The editor's whole claim is that it
 * only touches what you edited, and this is where an author checks that claim
 * before anything is written — so it is a real line diff (Myers-style LCS),
 * not a summary.
 */
export function unifiedDiff(
  before: string,
  after: string,
  context = 3,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = diffLines(a, b);
  if (!ops.some((op) => op.kind !== "same")) return "";

  const out: string[] = [];
  let aLine = 1;
  let bLine = 1;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "same") {
      aLine++;
      bLine++;
      i++;
      continue;
    }
    // Collect a hunk: changes plus `context` unchanged lines either side.
    const startOp = Math.max(0, i - context);
    let endOp = i;
    let lastChange = i;
    while (endOp < ops.length) {
      if (ops[endOp].kind !== "same") lastChange = endOp;
      else if (endOp - lastChange > context * 2) break;
      endOp++;
    }
    endOp = Math.min(ops.length, lastChange + context + 1);

    let aStart = aLine;
    let bStart = bLine;
    for (let k = i - 1; k >= startOp; k--) {
      if (ops[k].kind !== "add") aStart--;
      if (ops[k].kind !== "remove") bStart--;
    }
    const body: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (let k = startOp; k < endOp; k++) {
      const op = ops[k];
      if (op.kind === "same") {
        body.push(` ${op.line}`);
        aCount++;
        bCount++;
      } else if (op.kind === "remove") {
        body.push(`-${op.line}`);
        aCount++;
      } else {
        body.push(`+${op.line}`);
        bCount++;
      }
    }
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    out.push(...body);

    for (let k = i; k < endOp; k++) {
      if (ops[k].kind !== "add") aLine++;
      if (ops[k].kind !== "remove") bLine++;
    }
    i = endOp;
  }
  return out.join("\n");
}

type DiffOp = { kind: "same" | "add" | "remove"; line: string };

/** diffLines is a plain LCS line diff — enough for files this size. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "remove", line: a[i++] });
    } else {
      ops.push({ kind: "add", line: b[j++] });
    }
  }
  while (i < n) ops.push({ kind: "remove", line: a[i++] });
  while (j < m) ops.push({ kind: "add", line: b[j++] });
  return ops;
}

server.listen(opts.port, opts.host, () => {
  const shown = opts.host === "0.0.0.0" ? "localhost" : opts.host;
  console.log("sim-editor — simulator.yaml state machine editor");
  for (const spec of specs) {
    console.log(
      `  ${spec.relPath}${spec.shared ? `  (shared by ${spec.labIds.join(", ")})` : ""}`,
    );
  }
  console.log(`\n  http://${shown}:${opts.port}\n`);
  console.log(`  backups of every save: ${BACKUP_DIR}`);
});
