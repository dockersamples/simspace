// Wiring: one model, one selection, one render.
//
// The model is the WHOLE parsed file. Every form mutates it in place and the
// server diffs it against the file on disk to decide what to rewrite — so a key
// no form knows about survives an edit untouched, and a save touches only the
// lines you changed. Nothing is written until you have seen the diff.

import { button, debounce, draggable, el, fill, modal, toast } from "./dom.js";
import { renderEditor } from "./editor.js";
import { renderList } from "./list.js";
import { commandEcho, outputLine, renderSide, runFooter } from "./side.js";
import {
  newAgentScenario,
  newCommandScenario,
  scenarioIndexOf,
  uniqueId,
} from "./model.js";
import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from "/vendor/yaml/index.js";

const $ = (id) => document.getElementById(id);

const state = {
  files: [],
  path: null,
  doc: null,
  model: null,
  baseline: null,
  analysis: null,
  findings: [],
  comments: [],
  context: { terminalIds: [], stepIds: [], labIds: [] },
  selection: { kind: "none" },
  listTab: "scenarios",
  sideTab: "console",
  filter: "",
  dirty: false,
  undo: [],
  sessionState: null,
  validateOutput: "",
  console: {
    nodes: [],
    mode: "command",
    terminal: "",
    history: [],
    pos: null,
    focus: false,
    run: 0,
  },
};

// ── Server ───────────────────────────────────────────────────────────────────

async function api(route, body) {
  const res = await fetch(`/api/${route}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? `${route} failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadFiles() {
  const { files } = await api("files");
  state.files = files;
  fill(
    $("file-select"),
    files.map((f) =>
      el(
        "option",
        { value: f.path },
        `${f.relPath}${f.shared ? "  (shared)" : ""}`,
      ),
    ),
  );
  $("file-select").hidden = files.length < 2;
  if (files.length) await openFile(files[0].path);
}

async function openFile(path) {
  const doc = await api(`doc?path=${encodeURIComponent(path)}`);
  applyDoc(doc);
  state.path = doc.path;
  state.selection = doc.model?.scenarios?.length
    ? { kind: "scenario", index: 0 }
    : { kind: "lab" };
  resetUndo();
  state.console.nodes = [];
  state.console.history = doc.session?.history ?? [];
  $("file-select").value = doc.path;
  renderAll();
}

/** Adopts a document payload as the new baseline: not dirty, nothing to undo. */
function applyDoc(doc) {
  state.doc = doc;
  lastStep = JSON.stringify(doc.model);
  state.model = doc.model ?? {};
  state.baseline = JSON.stringify(doc.model);
  state.analysis = doc.analysis;
  state.findings = doc.findings ?? [];
  state.comments = doc.comments ?? [];
  state.context = doc.context ?? { terminalIds: [], stepIds: [], labIds: [] };
  state.sessionState = doc.session?.state ?? null;
  state.dirty = false;
}

/**
 * Re-derives the analysis and checks from the edited model, so the list tags,
 * the pre/post card and the Checks tab describe what you have now rather than
 * what is on disk. Debounced, because it round-trips to the engine.
 */
const refreshAnalysis = debounce(async () => {
  if (!state.path) return;
  try {
    const doc = await api("analyze", { path: state.path, model: state.model });
    state.analysis = doc.analysis;
    state.findings = doc.findings ?? [];
    renderList(listRoot(), ctx());
    if (state.sideTab === "checks") renderSide($("side"), ctx());
    renderBadge();
    if (state.selection.kind === "scenario") renderEditorPane();
  } catch (e) {
    // A model mid-edit can be unparseable by the engine (an empty command, say).
    // Keep the last good analysis rather than blanking the UI.
    state.findings = [
      { severity: "error", where: "spec", message: e.message, path: undefined },
    ];
    renderBadge();
    if (state.sideTab === "checks") renderSide($("side"), ctx());
  }
}, 300);

// ── Rendering ────────────────────────────────────────────────────────────────

function listRoot() {
  return $("list");
}

function renderEditorPane() {
  renderEditor($("editor"), ctx());
}

function renderAll() {
  renderList(listRoot(), ctx());
  renderEditorPane();
  renderSide($("side"), ctx());
  renderChrome();
  renderBadge();
  ensureStatePathList();
}

function renderChrome() {
  $("dirty").hidden = !state.dirty;
  $("undo").disabled = state.undo.length === 0;
  $("revert").disabled = !state.dirty;
  $("review").disabled = !state.dirty;
  const context = state.context ?? {};
  $("doc-meta").textContent = [
    context.labIds?.length ? context.labIds.join(", ") : "no labspace",
    `${(state.model?.scenarios ?? []).length} scenarios`,
    context.shared ? "shared spec" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderBadge() {
  const errors = state.findings.filter((f) => f.severity === "error").length;
  const warnings = state.findings.length - errors;
  const badge = $("checks-count");
  badge.textContent = String(errors || warnings || "");
  badge.className = `badge-count${errors || warnings ? " is-shown" : ""}${
    errors ? "" : " is-warn"
  }`;
}

/**
 * A shared <datalist> of every known state dot-path, so every path field in the
 * editor completes instead of inviting a typo — the single most common way a
 * scenario silently stops matching.
 */
function ensureStatePathList() {
  let list = $("state-paths");
  if (!list) {
    list = el("datalist", { id: "state-paths" });
    document.body.appendChild(list);
  }
  fill(
    list,
    (state.analysis?.state ?? []).map((f) => el("option", { value: f.path })),
  );
}

// ── The context every view gets ──────────────────────────────────────────────

function ctx() {
  return {
    ...state,
    terminalIds: state.context?.terminalIds ?? [],
    stepIds: state.context?.stepIds ?? [],
    paceNames: state.analysis?.paceNames ?? ["short", "medium", "long"],
    workflows: state.model?.workflows ?? [],
    workflowIds: (state.model?.workflows ?? []).map((w) => w.id),

    select(selection) {
      state.selection = selection;
      renderList(listRoot(), ctx());
      renderEditorPane();
    },
    edit,
    moveScenario(from, to) {
      const list = state.model.scenarios ?? [];
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      state.selection = { kind: "scenario", index: to };
      edit({ structural: true });
    },
    enableDrag: draggable,
    jumpToScenario(id) {
      const index = (state.model.scenarios ?? []).findIndex((s) => s.id === id);
      if (index >= 0) ctx().select({ kind: "scenario", index });
    },
    goToFinding(finding) {
      const index = scenarioIndexOf(finding.path);
      if (index >= 0) ctx().select({ kind: "scenario", index });
      else if (finding.path) ctx().select({ kind: "lab" });
    },
    toYaml(value) {
      try {
        return stringifyYaml(value ?? {}, { lineWidth: 0 });
      } catch (e) {
        return `# could not render: ${e.message}`;
      }
    },
    fromYaml(text) {
      try {
        return { value: parseYaml(text) };
      } catch (e) {
        return { error: e.message };
      }
    },
    runInConsole,
    previewOutput,
    resetConsole,
    setControl,
    runValidateLab,
    review,
  };
}

// The model as of the last recorded step, which is the state Undo goes back to.
// Forms mutate the model and then call edit(), so the "before" snapshot has to
// be kept here rather than captured inside edit().
let lastStep = null;
let lastStepAt = 0;

/**
 * The single edit entry point. `structural` means the shape changed (a row
 * added, a matcher kind switched, a reorder) and the pane has to be rebuilt;
 * plain typing passes false so the caret stays where it is.
 *
 * Undo records the model as it was BEFORE this edit. Typing would otherwise
 * push one entry per keystroke and make Undo useless, so consecutive
 * non-structural edits inside a second collapse into a single step.
 */
function edit({ structural = true } = {}) {
  const now = Date.now();
  const coalesce = !structural && now - lastStepAt < 1000;
  if (lastStep !== null && !coalesce) {
    state.undo.push(lastStep);
    if (state.undo.length > 80) state.undo.shift();
  }
  if (!coalesce) lastStepAt = now;
  lastStep = JSON.stringify(state.model);

  state.dirty = lastStep !== state.baseline;
  renderChrome();
  if (structural) {
    renderEditorPane();
    renderList(listRoot(), ctx());
  }
  refreshAnalysis();
}

function resetUndo() {
  state.undo = [];
  lastStep = state.baseline;
  lastStepAt = 0;
}

// ── Console ──────────────────────────────────────────────────────────────────

/**
 * Appends to the console. It writes straight into the live output element when
 * one is on screen rather than re-rendering the pane — a re-render per streamed
 * line would throw away whatever is half-typed in the input below it.
 */
function appendConsole(node) {
  if (!node) return;
  state.console.nodes.push(node);
  if (state.console.nodes.length > 400) {
    state.console.nodes.shift();
    state.console.nodes[0]?.parentNode?.firstChild?.remove?.();
  }
  const out = $("console-out");
  if (out) {
    out.appendChild(node);
    out.scrollTop = out.scrollHeight;
  } else if (state.sideTab === "console") {
    renderSide($("side"), ctx());
  }
}

/**
 * Runs a line through the engine built from the current model. Output is
 * revealed with the delays the scenario declares, because "does this pacing
 * feel right?" is a question you can only answer by watching it.
 */
async function runInConsole(line, terminal, mode = "command") {
  state.sideTab = "console";
  syncTabs();
  const expected =
    state.selection.kind === "scenario"
      ? state.model.scenarios?.[state.selection.index]?.id
      : undefined;

  appendConsole(commandEcho(line, mode));
  state.console.focus = true;
  const run = ++state.console.run;

  let result;
  try {
    result = await api("run", {
      path: state.path,
      model: state.model,
      line,
      mode,
      terminal: terminal || undefined,
    });
  } catch (e) {
    appendConsole(el("div.console-err", {}, e.message));
    return;
  }

  state.console.history = result.history ?? [];
  state.console.pos = null;
  state.sessionState = result.state;

  for (const outLine of result.lines ?? []) {
    if (state.console.run !== run) return; // a newer run took over
    if (outLine.delayMs) await sleep(Math.min(outLine.delayMs, 3000));
    appendConsole(outputLine(outLine));
  }
  appendConsole(
    runFooter(result, { expected, onJump: (id) => ctx().jumpToScenario(id) }),
  );
  renderList(listRoot(), ctx());
}

/** Streams a scenario's output without matching anything — a pacing preview. */
async function previewOutput(sc) {
  state.sideTab = "console";
  syncTabs();
  appendConsole(
    el(
      "div.console-note",
      {},
      `— preview of ${sc.id ?? "this scenario"}'s output —`,
    ),
  );
  const run = ++state.console.run;
  const pace = {
    short: 250,
    medium: 700,
    long: 1400,
    ...(state.model.settings?.pace ?? {}),
  };
  const streaming = state.model.settings?.streaming !== false;

  for (const key of ["output", "stderr"]) {
    for (const entry of sc.then?.[key] ?? []) {
      if (state.console.run !== run) return;
      const isObj = entry && typeof entry === "object";
      const delay = isObj ? entry.delay : undefined;
      const ms =
        !streaming || delay === undefined
          ? 0
          : typeof delay === "number"
            ? delay
            : (pace[delay] ?? 0);
      if (ms) await sleep(Math.min(ms, 3000));
      const text = isObj ? entry.text : entry;
      if (text === undefined) continue; // a pure pause prints nothing
      appendConsole(
        el(
          key === "stderr" ? "div.console-err" : "div",
          {},
          String(text) || " ",
        ),
      );
    }
  }
  appendConsole(el("div.console-note", {}, "— end of preview —"));
}

async function resetConsole() {
  const result = await api("reset", { path: state.path, model: state.model });
  state.sessionState = result.state;
  state.console.history = [];
  appendConsole(
    el("div.console-note", {}, "— state reset to the lab's seed —"),
  );
  renderList(listRoot(), ctx());
}

async function setControl(statePath, value) {
  const result = await api("control", {
    path: state.path,
    model: state.model,
    statePath,
    value,
  });
  state.sessionState = result.state;
  appendConsole(
    el(
      "div.console-note",
      {},
      `— ${statePath} set to ${JSON.stringify(value)} —`,
    ),
  );
  renderList(listRoot(), ctx());
}

async function runValidateLab() {
  state.validateOutput = "running validate-lab…";
  renderSide($("side"), ctx());
  try {
    const result = await api("validate-lab", { path: state.path });
    state.validateOutput = result.output || `(exit ${result.code})`;
    toast(
      result.code === 0
        ? "validate-lab passed"
        : "validate-lab reported problems",
      { kind: result.code === 0 ? "ok" : "err" },
    );
  } catch (e) {
    state.validateOutput = e.message;
  }
  renderSide($("side"), ctx());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Save ─────────────────────────────────────────────────────────────────────

/**
 * The save review. The editor's whole claim is that it rewrites only what you
 * edited; this is where that claim is checked, by the author, before anything
 * is written.
 */
async function review() {
  if (!state.dirty) return;
  let preview;
  try {
    preview = await api("preview", { path: state.path, model: state.model });
  } catch (e) {
    toast("Could not prepare the save", { kind: "err", detail: e.message });
    return;
  }

  const errors = state.findings.filter((f) => f.severity === "error");
  const close = modal({
    title: `Save ${state.doc.relPath}`,
    body: [
      preview.strategy === "rebuild"
        ? el(
            "div.notice.notice-warn",
            {},
            "This save re-serializes the whole file, so lines you didn't touch may be reformatted (comments are kept). It happens when an edit can't be expressed as a surgical change.",
          )
        : null,
      errors.length
        ? el(
            "div.notice.notice-err",
            {},
            `${errors.length} check${errors.length === 1 ? "" : "s"} failing — you can still save, but the lab won't validate.`,
          )
        : null,
      preview.diff
        ? el("pre.diff", {}, diffNodes(preview.diff))
        : el("div.notice", {}, "No textual change."),
    ],
    foot: [
      el(
        "span.field-hint",
        {},
        `${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"} · ${preview.strategy === "splice" ? "surgical write" : preview.strategy}`,
      ),
      el("div.row-flex", {}, [
        button("Cancel", { onclick: () => close() }),
        button("Save", {
          class: "btn-primary",
          onclick: async () => {
            close();
            await doSave();
          },
        }),
      ]),
    ],
  });
}

async function doSave() {
  try {
    const result = await api("save", {
      path: state.path,
      model: state.model,
      mtimeMs: state.doc.mtimeMs,
    });
    applyDoc(result.doc);
    resetUndo();
    renderAll();
    toast(`Saved — ${result.changes.length} change(s)`, {
      kind: "ok",
      detail: result.backup ? `previous version: ${result.backup}` : undefined,
    });
  } catch (e) {
    if (e.status === 409) {
      const reload = confirm(
        "The file changed on disk since you opened it (something else edited it).\n\n" +
          "OK reloads it and discards your unsaved edits. Cancel keeps them so you can copy anything you need.",
      );
      if (reload && e.data?.doc) {
        applyDoc(e.data.doc);
        resetUndo();
        renderAll();
      }
      return;
    }
    toast("Save failed — nothing was written", {
      kind: "err",
      detail: e.message,
    });
  }
}

function diffNodes(diff) {
  return diff.split("\n").map((line) => {
    if (line.startsWith("@@")) return el("span.diff-hunk", {}, line);
    if (line.startsWith("+")) return el("span.diff-add", {}, line);
    if (line.startsWith("-")) return el("span.diff-del", {}, line);
    return el("span", {}, `${line}\n`);
  });
}

// ── Chrome wiring ────────────────────────────────────────────────────────────

function syncTabs() {
  for (const tab of document.querySelectorAll("[data-list]")) {
    tab.classList.toggle("is-active", tab.dataset.list === state.listTab);
  }
  for (const tab of document.querySelectorAll("[data-side]")) {
    tab.classList.toggle("is-active", tab.dataset.side === state.sideTab);
  }
}

function addScenario(kind) {
  const list = (state.model.scenarios ??= []);
  const id = uniqueId(
    kind === "agent" ? "agent-turn" : "new-command",
    list.map((s) => s.id),
  );
  const scenario =
    kind === "agent" ? newAgentScenario(id) : newCommandScenario(id);
  const at =
    state.selection.kind === "scenario"
      ? state.selection.index + 1
      : list.length;
  list.splice(at, 0, scenario);
  state.listTab = "scenarios";
  syncTabs();
  state.selection = { kind: "scenario", index: at };
  edit({ structural: true });
}

function wire() {
  $("file-select").addEventListener("change", (e) => {
    if (state.dirty && !confirm("Discard unsaved changes and switch file?")) {
      e.target.value = state.path;
      return;
    }
    openFile(e.target.value);
  });

  $("filter").addEventListener(
    "input",
    debounce((e) => {
      state.filter = e.target.value;
      renderList(listRoot(), ctx());
    }, 120),
  );

  for (const tab of document.querySelectorAll("[data-list]")) {
    tab.addEventListener("click", () => {
      state.listTab = tab.dataset.list;
      if (state.listTab === "lab") state.selection = { kind: "lab" };
      syncTabs();
      renderList(listRoot(), ctx());
      renderEditorPane();
    });
  }
  for (const tab of document.querySelectorAll("[data-side]")) {
    tab.addEventListener("click", () => {
      state.sideTab = tab.dataset.side;
      syncTabs();
      renderSide($("side"), ctx());
    });
  }

  $("add-command").addEventListener("click", () => addScenario("command"));
  $("add-agent").addEventListener("click", () => addScenario("agent"));
  $("review").addEventListener("click", review);

  $("undo").addEventListener("click", () => {
    const previous = state.undo.pop();
    if (previous === undefined) return;
    state.model = JSON.parse(previous);
    lastStep = previous;
    lastStepAt = 0;
    state.dirty = previous !== state.baseline;
    renderAll();
    refreshAnalysis();
  });

  $("revert").addEventListener("click", () => {
    if (!confirm("Discard all unsaved changes?")) return;
    state.model = JSON.parse(state.baseline);
    state.dirty = false;
    resetUndo();
    renderAll();
    refreshAnalysis();
  });

  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      review();
    } else if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
      if (isTypingTarget(e.target)) return; // let the field's own undo work
      e.preventDefault();
      $("undo").click();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function isTypingTarget(node) {
  return /^(input|textarea|select)$/i.test(node?.tagName ?? "");
}

wire();
syncTabs();
loadFiles().catch((e) => {
  fill($("editor"), el("div.empty.err-text", {}, e.message));
});
