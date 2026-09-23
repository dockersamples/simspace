// The right pane: try it, check it, read it.
//
// "Try it" is the point of this pane. It runs the command through the REAL
// engine built from the model you are editing — unsaved and all — and reports
// which scenario actually matched, the output with its real delays, the exit
// code, and every state path that changed. That closes the loop the author
// otherwise closes by saving, switching to the app, resetting the lab and
// retyping four commands.

import { button, el, fill, iconButton, select, text } from "./dom.js";

export function renderSide(root, ctx) {
  if (ctx.sideTab === "checks") return fill(root, checksPanel(ctx));
  if (ctx.sideTab === "yaml") return fill(root, yamlPanel(ctx));
  return fill(root, consolePanel(root, ctx));
}

// ── Try it ───────────────────────────────────────────────────────────────────

function consolePanel(root, ctx) {
  const out = el("div.console-out", { id: "console-out" }, ctx.console.nodes);
  // Keep the newest output in view across re-renders.
  requestAnimationFrame(() => {
    out.scrollTop = out.scrollHeight;
  });

  const modeSelect = select(
    [
      { value: "command", label: "$ command" },
      { value: "prompt", label: "agent prompt" },
    ],
    ctx.console.mode,
    {
      onchange: (e) => {
        ctx.console.mode = e.target.value;
      },
    },
  );

  const terminalSelect = ctx.terminalIds.length
    ? select(
        [{ value: "", label: "any terminal" }, ...ctx.terminalIds],
        ctx.console.terminal,
        {
          onchange: (e) => {
            ctx.console.terminal = e.target.value;
          },
        },
      )
    : null;

  const input = text("", {
    class: "mono",
    placeholder: ctx.console.mode === "prompt" ? "ask the agent…" : "docker ps",
    onkeydown: (e) => {
      if (e.key === "Enter") {
        const line = e.target.value.trim();
        if (!line) return;
        e.target.value = "";
        ctx.runInConsole(line, ctx.console.terminal, ctx.console.mode);
        return;
      }
      // Up/down walk the session history, like a shell.
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const history = ctx.console.history;
        if (!history.length) return;
        e.preventDefault();
        ctx.console.pos =
          e.key === "ArrowUp"
            ? Math.max(0, (ctx.console.pos ?? history.length) - 1)
            : Math.min(history.length, (ctx.console.pos ?? history.length) + 1);
        e.target.value = history[ctx.console.pos] ?? "";
      }
    },
  });
  requestAnimationFrame(() => {
    if (ctx.console.focus) {
      input.focus();
      ctx.console.focus = false;
    }
  });

  return [
    el("div.row-flex", { style: { marginBottom: "6px" } }, [
      el("span.card-title", {}, "Try it"),
      el("span.field-hint", {}, "runs your unsaved edits"),
      el("span", { style: { flex: "1" } }),
      button("Reset state", {
        class: "btn-small",
        title: "Re-seed state and files from the lab's state: block",
        onclick: () => ctx.resetConsole(),
      }),
    ]),
    out,
    el(
      "div.console-form",
      {},
      [modeSelect, terminalSelect, input].filter(Boolean),
    ),
    el("div.row-flex", { style: { marginTop: "8px" } }, [
      el("span.field-hint", {}, "state now:"),
    ]),
    liveState(ctx),
    controlsRow(ctx),
  ];
}

/** The live session state, so a precondition can be checked at a glance. */
function liveState(ctx) {
  const flat = flatten(ctx.sessionState ?? {});
  if (!flat.length) {
    return el("div.field-hint", {}, "seeded — run a command to see it change");
  }
  return el(
    "div.inline-list",
    {},
    flat.map(([path, value]) =>
      el(
        "span.chip",
        { title: path },
        `${path}: ${typeof value === "string" ? value || '""' : JSON.stringify(value)}`,
      ),
    ),
  );
}

/** The lab's controls, so state gated behind a toggle can be flipped here. */
function controlsRow(ctx) {
  const controls = ctx.model.controls ?? [];
  if (!controls.length) return null;
  return el("div", { style: { marginTop: "10px" } }, [
    el("span.card-title", {}, "Controls"),
    ...controls.map((c) => {
      const current = valueAt(ctx.sessionState ?? {}, c.state);
      const on = JSON.stringify(current) === JSON.stringify(c.enabled ?? true);
      return el("label.row-flex", { style: { marginTop: "4px" } }, [
        el("input", {
          type: "checkbox",
          style: { width: "auto" },
          $: { checked: on },
          onchange: (e) =>
            ctx.setControl(
              c.state,
              e.target.checked ? (c.enabled ?? true) : (c.disabled ?? false),
            ),
        }),
        el("span", {}, c.label || c.id),
        el("span.faint.mono", {}, c.state),
      ]);
    }),
  ]);
}

// ── Console output rendering ─────────────────────────────────────────────────

export function commandEcho(line, mode) {
  return el("div", {}, [
    el("span.console-cmd", {}, mode === "prompt" ? "› " : "$ "),
    el("span", {}, line),
  ]);
}

export function outputLine(line) {
  if (line.pause) return null;
  return el(
    line.stream === "stderr" ? "div.console-err" : "div",
    {},
    line.text || " ",
  );
}

/**
 * The footer under each run: which scenario matched, and what it changed. When
 * the author asked for a specific scenario and a different one answered, that
 * is the headline — it's the failure mode the editor exists to catch.
 */
export function runFooter(result, { expected, onJump } = {}) {
  const parts = [];

  if (result.matched === "") {
    parts.push(
      el(
        "span.console-err",
        {},
        "no scenario matched — the unmatched default ran",
      ),
    );
  } else if (result.matched === "__builtin__") {
    parts.push(el("span.console-note", {}, "a built-in (ls/cat) handled this"));
  } else {
    parts.push(
      el("span.console-match", {}, "matched "),
      el(
        "span.chip.chip-link",
        { onclick: () => onJump?.(result.matched) },
        result.matched,
      ),
    );
  }

  if (expected && result.matched && expected !== result.matched) {
    parts.push(
      el(
        "span.console-err",
        {},
        `  — not "${expected}", which is the one you were editing`,
      ),
    );
  }
  if (result.exit !== 0) {
    parts.push(el("span.console-err", {}, `  exit ${result.exit}`));
  }
  if (result.completes) {
    parts.push(
      el("span.console-match", {}, `  ✓ completes ${result.completes}`),
    );
  }
  if (result.session) {
    parts.push(el("span.console-note", {}, "  → opens an agent session"));
  }
  if (result.input) {
    parts.push(el("span.console-note", {}, "  → asks for input"));
  }

  const changes = result.changed ?? [];
  return el("div", {}, [
    el("div", {}, parts),
    changes.length
      ? el(
          "div.console-note",
          {},
          changes
            .map(
              (c) =>
                `  ${c.path}: ${JSON.stringify(c.before ?? null)} → ${JSON.stringify(c.after ?? null)}`,
            )
            .join("\n"),
        )
      : null,
  ]);
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checksPanel(ctx) {
  const findings = ctx.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const group = (title, list) =>
    list.length
      ? [
          el("div.divider", {}, `${title} (${list.length})`),
          ...list.map((f) =>
            el(
              `div.finding.finding-${f.severity}`,
              { onclick: () => ctx.goToFinding(f) },
              [
                el("div.finding-where", {}, f.where),
                el("div.finding-msg", {}, f.message),
              ],
            ),
          ),
        ]
      : [];

  return [
    el("div.row-flex", { style: { marginBottom: "8px" } }, [
      el("span.card-title", {}, "Live checks"),
      el("span", { style: { flex: "1" } }),
      button("Run validate-lab", {
        class: "btn-small",
        title: "Run the repo's real validator over the whole lab",
        onclick: () => ctx.runValidateLab(),
      }),
    ]),
    ctx.doc?.parseError
      ? el("div.finding.finding-error", {}, [
          el("div.finding-where", {}, "parse"),
          el("div.finding-msg", {}, ctx.doc.parseError),
        ])
      : null,
    ...group("Errors", errors),
    ...group("Warnings", warnings),
    findings.length === 0 && !ctx.doc?.parseError
      ? el("div.empty", {}, "Nothing to report.")
      : null,
    ctx.validateOutput
      ? el("div", { style: { marginTop: "12px" } }, [
          el("div.divider", {}, "validate-lab"),
          el("pre.yaml-view", {}, ctx.validateOutput),
        ])
      : null,
    el(
      "div.field-hint",
      { style: { marginTop: "12px" } },
      "These checks run on every edit and cover this spec only. validate-lab also checks the markdown, the labspace references and the catalog — run it before committing.",
    ),
  ];
}

// ── YAML ─────────────────────────────────────────────────────────────────────

function yamlPanel(ctx) {
  return [
    el("div.row-flex", { style: { marginBottom: "8px" } }, [
      el("span.card-title", {}, "On disk"),
      el(
        "span.field-hint",
        {},
        ctx.dirty
          ? "your unsaved edits are not shown here"
          : "matches the editor",
      ),
      el("span", { style: { flex: "1" } }),
      ctx.dirty
        ? button("Review changes", {
            class: "btn-small",
            onclick: () => ctx.review(),
          })
        : null,
    ]),
    el("pre.yaml-view", {}, ctx.doc?.text ?? ""),
  ];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function flatten(tree, prefix = "", out = []) {
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    for (const [key, value] of Object.entries(tree)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (prefix) out.push([prefix, tree]);
  return out;
}

function valueAt(tree, path) {
  let node = tree;
  for (const part of String(path ?? "").split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

export { iconButton };
