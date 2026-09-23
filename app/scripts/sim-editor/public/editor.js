// The middle pane: the form for whatever is selected.
//
// The layout is deliberate. A scenario's identity and its PRE/POST STATE sit at
// the top, always visible, because "what does this need, what does it change,
// and who else answers this command" is the context you need before touching
// anything — and it is exactly what the YAML hides. Then the trigger, then the
// output (where the delay is a field beside the text, not a nested structure),
// then the rest of the effects.
//
// Rendering rule: typing in a text field mutates the model WITHOUT re-rendering
// (a re-render would take the caret with it). Anything structural — adding a
// row, changing a matcher kind, reordering — re-renders the pane.

import {
  button,
  card,
  el,
  field,
  fill,
  iconButton,
  select,
  text,
} from "./dom.js";
import {
  FILE_VERBS,
  MATCHER_KINDS,
  argRows,
  captures,
  clone,
  commandText,
  ensureArray,
  ensureObject,
  fileOpVerb,
  formatValue,
  moveItem,
  outputRows,
  pairLabel,
  parseValue,
  setArgRows,
  setCommandText,
  setFileOpVerb,
  setOrDelete,
  setOutputRows,
  setStateRows,
  stateRows,
  uniqueId,
} from "./model.js";

/** Renders the editor pane for the current selection. */
export function renderEditor(root, ctx) {
  const { selection } = ctx;

  // A file that doesn't parse has no model to build a form from. Say so here
  // rather than showing an empty editor, and show the text so the author can
  // find the problem — the YAML tab has it too, but nobody looks there first.
  if (ctx.doc?.parseError) {
    fill(root, [
      el("div.notice.notice-err", {}, [
        el(
          "strong",
          {},
          "This file doesn't parse, so it can't be edited as a form.",
        ),
        el("pre.diff", { style: { padding: "8px 0 0" } }, ctx.doc.parseError),
      ]),
      el(
        "div.field-hint",
        { style: { margin: "10px 0" } },
        "Fix it in your editor and reload this page.",
      ),
      el("pre.yaml-view", {}, ctx.doc.text ?? ""),
    ]);
    return;
  }

  if (selection.kind === "lab") {
    fill(root, labEditor(ctx));
    return;
  }
  if (selection.kind !== "scenario") {
    fill(
      root,
      el("div.empty", {}, [
        el("p", {}, "Select a scenario on the left."),
        el(
          "p.faint",
          {},
          "The list is in match order — the first scenario whose conditions hold is the one that fires.",
        ),
      ]),
    );
    return;
  }

  const scenario = ctx.model.scenarios?.[selection.index];
  if (!scenario) {
    fill(root, el("div.empty", {}, "That scenario is gone."));
    return;
  }
  fill(root, scenarioEditor(scenario, selection.index, ctx));
}

// ── Scenario ─────────────────────────────────────────────────────────────────

function scenarioEditor(sc, index, ctx) {
  const summary = ctx.analysis?.scenarios?.[index];
  const isAgent = Boolean(sc.when?.agent);
  const when = ensureObject(sc, "when");
  const then = ensureObject(sc, "then");

  return [
    identityCard(sc, index, ctx),
    stateCard(sc, index, summary, ctx),
    triggerCard(sc, when, isAgent, ctx),
    outputCard(then, "output", "Output (stdout)", ctx, sc),
    effectsCard(then, ctx),
    extrasCard(sc, then, ctx),
    rawCard(sc, index, ctx),
  ];
}

function identityCard(sc, index, ctx) {
  const ids = (ctx.model.scenarios ?? []).map((s) => s.id);
  const duplicate = ids.filter((id) => id === sc.id).length > 1;

  return card(
    `Scenario ${index + 1} of ${ctx.model.scenarios.length}`,
    [
      el("div.grid.grid-2", {}, [
        field(
          "id",
          text(sc.id, {
            class: "mono",
            oninput: (e) => {
              sc.id = e.target.value;
              ctx.edit({ structural: false });
            },
            onchange: () => ctx.edit({ structural: true }),
          }),
          duplicate
            ? el("span.err-text", {}, "another scenario has this id")
            : null,
        ),
        field(
          "completes (progress step)",
          ctx.stepIds.length
            ? select(
                [{ value: "", label: "— none —" }, ...ctx.stepIds],
                sc.completes ?? "",
                {
                  onchange: (e) => {
                    setOrDelete(sc, "completes", e.target.value);
                    ctx.edit({ structural: true });
                  },
                },
              )
            : text(sc.completes ?? "", {
                class: "mono",
                placeholder: "step id from labspace.yaml",
                oninput: (e) => {
                  setOrDelete(sc, "completes", e.target.value.trim());
                  ctx.edit({ structural: false });
                },
              }),
          ctx.stepIds.length
            ? "Marks this step done when the scenario fires."
            : "No section steps declared in labspace.yaml.",
        ),
      ]),
      field(
        "description (author note)",
        text(sc.description ?? "", {
          placeholder: "Why this scenario exists",
          oninput: (e) => {
            setOrDelete(sc, "description", e.target.value);
            ctx.edit({ structural: false });
          },
        }),
      ),
    ],
    [
      iconButton("↑", "Move earlier (higher priority)", () =>
        ctx.moveScenario(index, index - 1),
      ),
      iconButton("↓", "Move later (lower priority)", () =>
        ctx.moveScenario(index, index + 1),
      ),
      iconButton("⧉", "Duplicate", () => {
        const copy = clone(sc);
        copy.id = uniqueId(
          `${sc.id}-copy`,
          (ctx.model.scenarios ?? []).map((s) => s.id),
        );
        ctx.model.scenarios.splice(index + 1, 0, copy);
        ctx.select({ kind: "scenario", index: index + 1 });
        ctx.edit({ structural: true });
      }),
      iconButton(
        "🗑",
        "Delete this scenario",
        () => {
          if (!confirm(`Delete scenario "${sc.id}"?`)) return;
          ctx.model.scenarios.splice(index, 1);
          ctx.select({
            kind: "scenario",
            index: Math.min(index, ctx.model.scenarios.length - 1),
          });
          ctx.edit({ structural: true });
        },
        "btn-danger",
      ),
    ],
  );
}

/**
 * The pre/post card: the state this scenario needs, the state it writes, and
 * the scenarios on either side of it in the state machine. The overlap list is
 * the answer to "why didn't my change take effect?" — nearly always because
 * something earlier in the file matched first.
 */
function stateCard(sc, index, summary, ctx) {
  const overlaps = ctx.analysis?.overlaps?.[sc.id] ?? [];
  const transitions = ctx.analysis?.transitions?.[sc.id] ?? {
    from: [],
    to: [],
  };
  const shadowedBy = overlaps.filter((o) => o.relation === "shadowed-by");
  const shadows = overlaps.filter((o) => o.relation === "shadows");
  const sameTrigger = overlaps.filter((o) => o.relation === "same-trigger");

  const jump = (id) => {
    const i = (ctx.model.scenarios ?? []).findIndex((s) => s.id === id);
    if (i >= 0) ctx.select({ kind: "scenario", index: i });
  };
  const chips = (ids, empty) =>
    ids.length
      ? el(
          "div.inline-list",
          {},
          ids.map((id) =>
            el("span.chip.chip-link", { onclick: () => jump(id) }, id),
          ),
        )
      : el("span.faint", {}, empty);

  return card("Active state", [
    el("div.prepost", {}, [
      el("div", {}, [
        el("label", {}, "requires (pre)"),
        (summary?.requires ?? []).length
          ? el(
              "div.inline-list",
              {},
              summary.requires.map((p) => el("span.chip", {}, pairLabel(p))),
            )
          : el("span.faint", {}, "no preconditions — matches in any state"),
        el("div", { style: { marginTop: "8px" } }, [
          el("label", {}, "reached from"),
          chips(transitions.from, "nothing sets the state this needs"),
        ]),
      ]),
      el("div", {}, [
        el("label", {}, "sets (post)"),
        (summary?.sets ?? []).length
          ? el(
              "div.inline-list",
              {},
              summary.sets.map((p) => el("span.chip", {}, pairLabel(p))),
            )
          : el("span.faint", {}, "changes no state"),
        el("div", { style: { marginTop: "8px" } }, [
          el("label", {}, "leads to"),
          chips(transitions.to, "unlocks nothing"),
        ]),
      ]),
    ]),

    shadowedBy.length
      ? el("div", { style: { marginTop: "10px" } }, [
          el("label", {}, "unreachable"),
          el("div.err-text", {}, [
            `This scenario can never fire: `,
            ...shadowedBy.map((o) =>
              el(
                "span.chip.chip-link",
                { onclick: () => jump(o.id) },
                `#${o.index + 1} ${o.id}`,
              ),
            ),
            ` comes first and ${shadowedBy[0].reason}. Move this one above it.`,
          ]),
        ])
      : null,

    shadows.length
      ? el("div", { style: { marginTop: "10px" } }, [
          el("label", {}, "shadows"),
          el("div.warn-text", {}, [
            "Always matches before ",
            ...shadows.map((o) =>
              el(
                "span.chip.chip-link",
                { onclick: () => jump(o.id) },
                `#${o.index + 1} ${o.id}`,
              ),
            ),
            ", which can therefore never fire.",
          ]),
        ])
      : null,

    sameTrigger.length
      ? el("div", { style: { marginTop: "10px" } }, [
          el(
            "label",
            {},
            `also answers this command (${index + 1} of ${sameTrigger.length + 1} in match order)`,
          ),
          el(
            "div.inline-list",
            {},
            sameTrigger.map((o) =>
              el(
                "span.chip.chip-link",
                {
                  onclick: () => jump(o.id),
                  title:
                    o.index < index
                      ? "matched before this one"
                      : "matched after this one",
                },
                `${o.index < index ? "↑" : "↓"} #${o.index + 1} ${o.id}`,
              ),
            ),
          ),
        ])
      : null,
  ]);
}

function triggerCard(sc, when, isAgent, ctx) {
  const body = [
    el("div.grid.grid-2", {}, [
      field(
        "matches",
        select(
          [
            { value: "command", label: "a typed command" },
            { value: "agent", label: "an agent prompt" },
          ],
          isAgent ? "agent" : "command",
          {
            onchange: (e) => {
              if (e.target.value === "agent") {
                delete when.command;
                when.agent = true;
                if (!when.prompt && !when.promptContains)
                  when.promptContains = [];
              } else {
                delete when.agent;
                delete when.promptContains;
                if (when.command === undefined) when.command = "";
              }
              ctx.edit({ structural: true });
            },
          },
        ),
        isAgent
          ? "Matched against a prompt typed in an agent session."
          : "Matched against a command line, first match wins.",
      ),
      field(
        "terminal",
        select(
          [{ value: "", label: "— any terminal —" }, ...ctx.terminalIds],
          when.terminal ?? "",
          {
            onchange: (e) => {
              setOrDelete(when, "terminal", e.target.value);
              ctx.edit({ structural: true });
            },
          },
        ),
        ctx.terminalIds.length
          ? "Restricts this scenario to one terminal tab."
          : "No terminals declared in labspace.yaml.",
      ),
    ]),

    isAgent
      ? agentTriggerFields(when, ctx)
      : field(
          "command",
          text(commandText(when), {
            class: "mono",
            placeholder: "docker run",
            oninput: (e) => {
              setCommandText(when, e.target.value);
              ctx.edit({ structural: false });
            },
            onchange: () => ctx.edit({ structural: true }),
          }),
          "The leading tokens only. Flags and positional values go in the matchers below.",
        ),

    !isAgent ? argsEditor(when, ctx) : null,
    !isAgent
      ? field(
          "positional text (when.prompt)",
          text(when.prompt ?? "", {
            class: "mono",
            placeholder: "express@4.19.2",
            oninput: (e) => {
              setOrDelete(when, "prompt", e.target.value);
              ctx.edit({ structural: false });
            },
            onchange: () => ctx.edit({ structural: true }),
          }),
          "Optional. Matches the tokens after the command path, joined — handy for one-argument commands.",
        )
      : null,

    statePairsEditor(when, "state", "state preconditions", ctx, {
      hint: "All must hold. A missing key compares equal to false/null, so `x: false` also matches an unset key.",
    }),
  ];

  return card("Trigger — when", body, [
    !isAgent && ctx.analysis?.scenarios?.[ctx.selection.index]?.example
      ? button("Try it", {
          class: "btn-small",
          title: "Run this command in the console",
          onclick: () =>
            ctx.runInConsole(
              ctx.analysis.scenarios[ctx.selection.index].example,
              when.terminal,
            ),
        })
      : null,
  ]);
}

function agentTriggerFields(when, ctx) {
  const mode = when.prompt !== undefined ? "exact" : "contains";
  return el("div.stack", {}, [
    field(
      "prompt match",
      select(
        [
          { value: "contains", label: "contains all of these keywords" },
          { value: "exact", label: "is exactly this prompt" },
        ],
        mode,
        {
          onchange: (e) => {
            if (e.target.value === "exact") {
              delete when.promptContains;
              when.prompt = "";
            } else {
              delete when.prompt;
              when.promptContains = [];
            }
            ctx.edit({ structural: true });
          },
        },
      ),
    ),
    mode === "exact"
      ? field(
          "prompt (exact, trimmed)",
          text(when.prompt ?? "", {
            class: "mono",
            oninput: (e) => {
              when.prompt = e.target.value;
              ctx.edit({ structural: false });
            },
          }),
        )
      : field(
          "keywords (comma separated, case-insensitive, all must appear)",
          text((when.promptContains ?? []).join(", "), {
            class: "mono",
            placeholder: "health, endpoint",
            oninput: (e) => {
              const list = e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
              when.promptContains = list;
              ctx.edit({ structural: false });
            },
            onchange: () => ctx.edit({ structural: true }),
          }),
          "Leave empty for a catch-all — place that scenario last.",
        ),
  ]);
}

function argsEditor(when, ctx) {
  const rows = argRows(when);
  const write = () => {
    setArgRows(when, rows);
    ctx.edit({ structural: true });
  };

  return el("div", {}, [
    el("label", {}, "argument matchers"),
    el(
      "div.statelist",
      {},
      rows.map((row, i) => {
        const kind = MATCHER_KINDS.find((k) => k.kind === row.kind);
        return el("div.pair.pair-op", {}, [
          text(row.name, {
            class: "mono",
            placeholder: "--name or 0",
            oninput: (e) => {
              rows[i].name = e.target.value;
              setArgRows(when, rows);
              ctx.edit({ structural: false });
            },
            onchange: write,
          }),
          select(
            MATCHER_KINDS.map((k) => ({ value: k.kind, label: k.label })),
            row.kind,
            {
              onchange: (e) => {
                rows[i].kind = e.target.value;
                write();
              },
            },
          ),
          kind?.hasValue
            ? text(row.value, {
                class: "mono",
                placeholder: row.kind === "oneOf" ? "a, b, c" : "value",
                oninput: (e) => {
                  rows[i].value = e.target.value;
                  setArgRows(when, rows);
                  ctx.edit({ structural: false });
                },
                onchange: write,
              })
            : el("span.faint", {}, "—"),
          iconButton(
            "✕",
            "Remove this matcher",
            () => {
              rows.splice(i, 1);
              write();
            },
            "btn-danger",
          ),
        ]);
      }),
    ),
    el("div.row-flex", { style: { marginTop: "6px" } }, [
      button("+ flag", {
        class: "btn-small",
        onclick: () => {
          rows.push({ name: "--flag", kind: "any", value: "" });
          write();
        },
      }),
      button("+ positional", {
        class: "btn-small",
        onclick: () => {
          const used = rows.filter((r) => /^\d+$/.test(r.name)).length;
          rows.push({ name: String(used), kind: "any", value: "" });
          write();
        },
      }),
      el(
        "span.field-hint",
        {},
        captures(when).length
          ? `captures: ${captures(when)
              .map((c) => `{{ args.${c} }}`)
              .join("  ")}`
          : "no captures — add an `equals`, `any`, or `one of` matcher to use {{ args.… }}",
      ),
    ]),
  ]);
}

// ── Output ───────────────────────────────────────────────────────────────────

/**
 * The output editor. Each line is one row with its delay beside it, because
 * pacing is something you tune while reading the lines in order — not by
 * editing a nested mapping. `stderr` gets the same editor, collapsed until it
 * has content.
 */
function outputCard(then, key, title, ctx, sc) {
  const body = [outputRowsEditor(then, key, ctx)];

  if (key === "output") {
    const hasStderr = Array.isArray(then.stderr) && then.stderr.length > 0;
    body.push(
      el("details", { open: hasStderr }, [
        el("summary", {}, hasStderr ? "stderr" : "add stderr"),
        outputRowsEditor(then, "stderr", ctx),
      ]),
    );
  }

  return card(title, body, [
    el(
      "span.field-hint",
      {},
      `${(then[key] ?? []).length} line${(then[key] ?? []).length === 1 ? "" : "s"}`,
    ),
    button("▶ Preview", {
      class: "btn-small",
      title: "Stream this scenario's output in the console, with its delays",
      onclick: () => ctx.previewOutput(sc),
    }),
  ]);
}

function outputRowsEditor(then, key, ctx) {
  const rows = outputRows(then[key]);
  const write = (structural = true) => {
    setOutputRows(then, key, rows);
    ctx.edit({ structural });
  };
  const delayOptions = [
    { value: "", label: "no delay" },
    ...ctx.paceNames.map((p) => ({ value: p, label: p })),
    { value: "__ms__", label: "milliseconds…" },
  ];

  const container = el(
    "div.outputs",
    {},
    rows.map((row, i) => {
      const isMs = row.delay !== "" && /^\d+$/.test(row.delay);
      return el(
        `div.out${row.pause ? ".is-pause" : ""}`,
        { draggable: "true", "data-index": String(i) },
        [
          el("span.out-handle", { title: "Drag to reorder" }, "⋮⋮"),
          row.pause
            ? el("span.out-text.faint", {}, "(pause — prints nothing)")
            : multiline(row.text)
              ? el("textarea.mono.out-text", {
                  rows: Math.min(12, row.text.split("\n").length + 1),
                  $: { value: row.text },
                  oninput: (e) => {
                    rows[i].text = e.target.value;
                    write(false);
                  },
                })
              : text(row.text, {
                  class: "mono out-text",
                  placeholder: "output line",
                  oninput: (e) => {
                    rows[i].text = e.target.value;
                    write(false);
                  },
                  onpaste: (e) => {
                    const pasted = e.clipboardData?.getData("text") ?? "";
                    if (!pasted.includes("\n")) return;
                    // Pasting real CLI output should become one row per line,
                    // which is what you want every single time.
                    e.preventDefault();
                    const lines = pasted.replace(/\n$/, "").split("\n");
                    rows.splice(
                      i,
                      1,
                      ...lines.map((t) => ({
                        text: t,
                        delay: row.delay,
                        pause: false,
                      })),
                    );
                    write();
                  },
                }),
          isMs
            ? el("div.row-flex", {}, [
                el("input.mono", {
                  type: "number",
                  min: "0",
                  step: "50",
                  $: { value: row.delay },
                  oninput: (e) => {
                    rows[i].delay = e.target.value;
                    write(false);
                  },
                  onchange: () => write(),
                }),
              ])
            : select(delayOptions, row.delay, {
                onchange: (e) => {
                  rows[i].delay =
                    e.target.value === "__ms__" ? "500" : e.target.value;
                  write();
                },
              }),
          el("div.out-actions", {}, [
            iconButton("⏎", "Insert a line below", () => {
              rows.splice(i + 1, 0, { text: "", delay: "", pause: false });
              write();
            }),
            iconButton("⏸", "Insert a pause below", () => {
              rows.splice(i + 1, 0, { text: "", delay: "medium", pause: true });
              write();
            }),
            iconButton(
              "✕",
              "Remove this line",
              () => {
                rows.splice(i, 1);
                write();
              },
              "btn-danger",
            ),
          ]),
        ],
      );
    }),
  );

  ctx.enableDrag(container, (from, to) => {
    moveItem(rows, from, to);
    write();
  });

  return el("div", {}, [
    container,
    el("div.row-flex", { style: { marginTop: "6px" } }, [
      button("+ line", {
        class: "btn-small",
        onclick: () => {
          rows.push({ text: "", delay: "", pause: false });
          write();
        },
      }),
      button("+ pause", {
        class: "btn-small",
        title:
          "A delay that prints nothing — holds a beat before the next line",
        onclick: () => {
          rows.push({ text: "", delay: "medium", pause: true });
          write();
        },
      }),
      button("Paste lines…", {
        class: "btn-small",
        title: "Paste multi-line command output as one row per line",
        onclick: () => {
          const pasted = prompt("Paste output — one line each:");
          if (!pasted) return;
          for (const line of pasted.replace(/\n$/, "").split("\n")) {
            rows.push({ text: line, delay: "", pause: false });
          }
          write();
        },
      }),
      rows.length
        ? el("span.field-hint", {}, "⋮⋮ drag to reorder")
        : el("span.field-hint", {}, "no lines — this scenario prints nothing"),
    ]),
  ]);
}

function multiline(value) {
  return typeof value === "string" && value.includes("\n");
}

// ── Effects ──────────────────────────────────────────────────────────────────

function effectsCard(then, ctx) {
  return card("Effects — then", [
    statePairsEditor(then, "state", "state changes", ctx, {
      append: true,
      hint: "Applied before output renders, so {{ state.x }} in a line sees the new value.",
    }),
    el("div.grid.grid-3", { style: { marginTop: "10px" } }, [
      field(
        "exit code",
        el("input.mono", {
          type: "number",
          $: { value: then.exit ?? 0 },
          onchange: (e) => {
            const value = Number(e.target.value);
            if (value === 0) delete then.exit;
            else then.exit = value;
            ctx.edit({ structural: true });
          },
        }),
        "0 means success.",
      ),
    ]),
    filesEditor(then, ctx),
  ]);
}

/** A dot-path/value table, used for both `when.state` and `then.state`. */
function statePairsEditor(
  obj,
  key,
  label,
  ctx,
  { append: allowAppend = false, hint } = {},
) {
  const rows = stateRows(obj[key]);
  const write = (structural = true) => {
    setStateRows(obj, key, rows);
    ctx.edit({ structural });
  };
  const paths = ctx.analysis?.state?.map((f) => f.path) ?? [];

  return el("div", {}, [
    el("label", {}, label),
    el(
      "div.statelist",
      {},
      rows.map((row, i) =>
        el(`div.pair${allowAppend ? ".pair-op" : ""}`, {}, [
          el("input.mono", {
            type: "text",
            list: "state-paths",
            placeholder: "container.running",
            $: { value: row.path },
            oninput: (e) => {
              rows[i].path = e.target.value;
              write(false);
            },
            onchange: () => write(),
          }),
          allowAppend
            ? select(
                [
                  { value: "set", label: "set to" },
                  { value: "append", label: "append (+=)" },
                ],
                row.append ? "append" : "set",
                {
                  onchange: (e) => {
                    rows[i].append = e.target.value === "append";
                    write();
                  },
                },
              )
            : null,
          text(row.value, {
            class: "mono",
            placeholder: "true",
            oninput: (e) => {
              rows[i].value = e.target.value;
              write(false);
            },
            onchange: () => write(),
          }),
          iconButton(
            "✕",
            "Remove",
            () => {
              rows.splice(i, 1);
              write();
            },
            "btn-danger",
          ),
        ]),
      ),
    ),
    el("div.row-flex", { style: { marginTop: "6px" } }, [
      button("+ state", {
        class: "btn-small",
        onclick: () => {
          rows.push({ path: paths[0] ?? "", append: false, value: "true" });
          write();
        },
      }),
      hint ? el("span.field-hint", {}, hint) : null,
    ]),
  ]);
}

function filesEditor(then, ctx) {
  const ops = Array.isArray(then.files) ? then.files : [];
  const write = (structural = true) => {
    setOrDelete(then, "files", ops);
    ctx.edit({ structural });
  };

  return el("details", { open: ops.length > 0, style: { marginTop: "10px" } }, [
    el(
      "summary",
      {},
      ops.length ? `file changes (${ops.length})` : "add file changes",
    ),
    el(
      "div.stack",
      {},
      ops.map((op, i) => {
        const verb = fileOpVerb(op);
        const spec = FILE_VERBS.find((v) => v.verb === verb);
        return el("div.card", {}, [
          el("div.card-body", {}, [
            el("div.files-op", {}, [
              select(
                FILE_VERBS.map((v) => ({ value: v.verb, label: v.label })),
                verb,
                {
                  onchange: (e) => {
                    setFileOpVerb(op, e.target.value);
                    write();
                  },
                },
              ),
              text(op[verb] ?? "", {
                class: "mono",
                placeholder: "app/server.js",
                oninput: (e) => {
                  op[verb] = e.target.value;
                  write(false);
                },
                onchange: () => write(),
              }),
              iconButton(
                "✕",
                "Remove this operation",
                () => {
                  ops.splice(i, 1);
                  write();
                },
                "btn-danger",
              ),
            ]),
            ...(spec?.fields ?? []).map((name) =>
              field(
                name,
                name === "to"
                  ? text(op.to ?? "", {
                      class: "mono",
                      placeholder: "app/server.bak",
                      oninput: (e) => {
                        op.to = e.target.value;
                        write(false);
                      },
                      onchange: () => write(),
                    })
                  : el("textarea.mono", {
                      rows: name === "content" ? 6 : 2,
                      placeholder:
                        name === "find"
                          ? "exact text to find (required)"
                          : name === "with"
                            ? "replacement text"
                            : "file contents",
                      $: { value: op[name] ?? "" },
                      oninput: (e) => {
                        setOrDelete(op, name, e.target.value);
                        write(false);
                      },
                      onchange: () => write(),
                    }),
                name === "find" && op.replace !== undefined && !op.find
                  ? el(
                      "span.err-text",
                      {},
                      "a replace with no find fails at run time",
                    )
                  : null,
              ),
            ),
          ]),
        ]);
      }),
    ),
    button("+ file change", {
      class: "btn-small",
      onclick: () => {
        ops.push({ create: "", content: "" });
        write();
      },
    }),
  ]);
}

// ── The rest of `then`: session, input, ci, mcp ──────────────────────────────

function extrasCard(sc, then, ctx) {
  const rows = [];

  rows.push(
    toggleSection(
      "agent session",
      then.session !== undefined,
      (on) => {
        if (on) then.session = { prompt: "agent> ", intro: [] };
        else delete then.session;
        ctx.edit({ structural: true });
      },
      () =>
        el("div.stack", {}, [
          field(
            "REPL prompt",
            text(then.session.prompt ?? "", {
              class: "mono",
              placeholder: "agent> ",
              oninput: (e) => {
                setOrDelete(then.session, "prompt", e.target.value);
                ctx.edit({ structural: false });
              },
            }),
          ),
          linesField("intro lines", then.session, "intro", ctx),
          linesField("outro lines", then.session, "outro", ctx),
        ]),
    ),
  );

  rows.push(
    toggleSection(
      "interactive input",
      then.input !== undefined,
      (on) => {
        if (on) {
          then.input = {
            prompt: "Enter value: ",
            key: "value",
            then: { output: [] },
          };
        } else delete then.input;
        ctx.edit({ structural: true });
      },
      () => inputEditor(then.input, ctx),
    ),
  );

  rows.push(
    toggleSection(
      "CI run",
      then.ci !== undefined,
      (on) => {
        if (on) then.ci = { workflow: ctx.workflowIds[0] ?? "" };
        else delete then.ci;
        ctx.edit({ structural: true });
      },
      () => ciEditor(then.ci, ctx),
    ),
  );

  rows.push(
    toggleSection(
      "mocked MCP calls",
      Array.isArray(then.mcp) && then.mcp.length > 0,
      (on) => {
        if (on) then.mcp = [{ tool: "", arguments: {}, result: "" }];
        else delete then.mcp;
        ctx.edit({ structural: true });
      },
      () => mcpEditor(then.mcp, ctx),
    ),
  );

  return card("Also happens", rows);
}

function toggleSection(label, on, toggle, render) {
  return el("div", { style: { marginBottom: "8px" } }, [
    el("label.row-flex", {}, [
      el("input", {
        type: "checkbox",
        style: { width: "auto" },
        $: { checked: on },
        onchange: (e) => toggle(e.target.checked),
      }),
      el("span", {}, label),
    ]),
    on ? render() : null,
  ]);
}

/** A string-list field (session intro/outro, workflow logs) as one line each. */
function linesField(label, obj, key, ctx) {
  const lines = Array.isArray(obj[key]) ? obj[key] : [];
  return field(
    label,
    el("textarea.mono", {
      rows: Math.max(2, lines.length + 1),
      $: { value: lines.join("\n") },
      oninput: (e) => {
        const value = e.target.value;
        setOrDelete(obj, key, value === "" ? [] : value.split("\n"));
        ctx.edit({ structural: false });
      },
      onchange: () => ctx.edit({ structural: true }),
    }),
    "One line per row.",
  );
}

function inputEditor(input, ctx) {
  // The spec allows a single-step shorthand (fields on `input` itself) and an
  // explicit `steps:` list. Keep whichever the author used until the step count
  // forces a change.
  const steps = Array.isArray(input.steps)
    ? input.steps
    : [
        {
          key: input.key ?? "value",
          prompt: input.prompt ?? "",
          mask: input.mask,
        },
      ];
  const writeSteps = () => {
    if (steps.length === 1 && !Array.isArray(input.steps)) {
      input.key = steps[0].key;
      input.prompt = steps[0].prompt;
      setOrDelete(input, "mask", steps[0].mask === true ? true : "");
    } else {
      delete input.key;
      delete input.prompt;
      delete input.mask;
      input.steps = steps;
    }
    ctx.edit({ structural: true });
  };
  const then = ensureObject(input, "then");

  return el("div.stack", {}, [
    el("label", {}, "questions"),
    ...steps.map((step, i) =>
      el("div.pair.pair-op", {}, [
        text(step.prompt ?? "", {
          class: "mono",
          placeholder: "Enter value: ",
          oninput: (e) => {
            steps[i].prompt = e.target.value;
            if (steps.length === 1 && !Array.isArray(input.steps)) {
              input.prompt = e.target.value;
            }
            ctx.edit({ structural: false });
          },
          onchange: writeSteps,
        }),
        text(step.key ?? "", {
          class: "mono",
          placeholder: "key",
          oninput: (e) => {
            steps[i].key = e.target.value;
            if (steps.length === 1 && !Array.isArray(input.steps)) {
              input.key = e.target.value;
            }
            ctx.edit({ structural: false });
          },
          onchange: writeSteps,
        }),
        el("label.row-flex", {}, [
          el("input", {
            type: "checkbox",
            style: { width: "auto" },
            $: { checked: step.mask === true },
            onchange: (e) => {
              steps[i].mask = e.target.checked;
              writeSteps();
            },
          }),
          el("span", {}, "mask"),
        ]),
        iconButton(
          "✕",
          "Remove this question",
          () => {
            if (steps.length === 1) return;
            steps.splice(i, 1);
            input.steps = steps;
            writeSteps();
          },
          "btn-danger",
        ),
      ]),
    ),
    button("+ question", {
      class: "btn-small",
      onclick: () => {
        steps.push({ key: "", prompt: "" });
        input.steps = steps;
        writeSteps();
      },
    }),
    el("label", { style: { marginTop: "6px" } }, "once answered"),
    el("div.card", {}, [
      el("div.card-body", {}, [
        outputRowsEditor(then, "output", ctx),
        statePairsEditor(then, "state", "state changes", ctx, { append: true }),
        el(
          "div.field-hint",
          {},
          "Reads {{ input.<key> }}, plus the opening command's {{ args.* }}.",
        ),
      ]),
    ]),
  ]);
}

function ciEditor(ci, ctx) {
  const workflow = ctx.workflows.find((w) => w.id === ci.workflow);
  const stepIds = (workflow?.steps ?? []).map((s) => s.id);
  return el("div.stack", {}, [
    el("div.grid.grid-2", {}, [
      field(
        "workflow",
        select(
          [
            { value: "", label: "— pick a workflow —" },
            ...ctx.workflowIds.map((id) => ({ value: id, label: id })),
          ],
          ci.workflow ?? "",
          {
            onchange: (e) => {
              ci.workflow = e.target.value;
              ctx.edit({ structural: true });
            },
          },
        ),
        ctx.workflowIds.length
          ? null
          : el(
              "span.err-text",
              {},
              "no workflows declared — add one in the Lab tab",
            ),
      ),
      field(
        "conclusion",
        select(
          [
            { value: "", label: "derive from state (requires)" },
            { value: "success", label: "success" },
            { value: "failure", label: "failure" },
          ],
          ci.conclusion ?? "",
          {
            onchange: (e) => {
              setOrDelete(ci, "conclusion", e.target.value);
              ctx.edit({ structural: true });
            },
          },
        ),
        "Leave on derive so the CI panel's Re-run can pick up a changed setting.",
      ),
    ]),
    el("div.grid.grid-2", {}, [
      field(
        "commit label",
        text(ci.commit ?? "", {
          oninput: (e) => {
            setOrDelete(ci, "commit", e.target.value);
            ctx.edit({ structural: false });
          },
        }),
      ),
      ci.conclusion === "failure"
        ? field(
            "failing step",
            select(
              [{ value: "", label: "— the last step —" }, ...stepIds],
              ci.failedStep ?? "",
              {
                onchange: (e) => {
                  setOrDelete(ci, "failedStep", e.target.value);
                  ctx.edit({ structural: true });
                },
              },
            ),
          )
        : null,
    ]),
    field(
      "error message",
      text(ci.error ?? "", {
        oninput: (e) => {
          setOrDelete(ci, "error", e.target.value);
          ctx.edit({ structural: false });
        },
      }),
    ),
  ]);
}

function mcpEditor(calls, ctx) {
  return el("div.stack", {}, [
    ...calls.map((call, i) =>
      el("div.card", {}, [
        el("div.card-body", {}, [
          field(
            "tool",
            text(call.tool ?? "", {
              class: "mono",
              placeholder: "github.search",
              oninput: (e) => {
                call.tool = e.target.value;
                ctx.edit({ structural: false });
              },
            }),
          ),
          field(
            "arguments (one key: value per line)",
            el("textarea.mono", {
              rows: 3,
              $: {
                value: Object.entries(call.arguments ?? {})
                  .map(([k, v]) => `${k}: ${formatValue(v)}`)
                  .join("\n"),
              },
              onchange: (e) => {
                const args = {};
                for (const line of e.target.value.split("\n")) {
                  const at = line.indexOf(":");
                  if (at < 0) continue;
                  args[line.slice(0, at).trim()] = parseValue(
                    line.slice(at + 1),
                  );
                }
                setOrDelete(call, "arguments", args);
                ctx.edit({ structural: true });
              },
            }),
          ),
          field(
            "result",
            el("textarea.mono", {
              rows: 3,
              $: { value: call.result ?? "" },
              oninput: (e) => {
                setOrDelete(call, "result", e.target.value);
                ctx.edit({ structural: false });
              },
            }),
          ),
          iconButton(
            "✕",
            "Remove this call",
            () => {
              calls.splice(i, 1);
              ctx.edit({ structural: true });
            },
            "btn-danger",
          ),
        ]),
      ]),
    ),
    button("+ MCP call", {
      class: "btn-small",
      onclick: () => {
        calls.push({ tool: "", result: "" });
        ctx.edit({ structural: true });
      },
    }),
  ]);
}

/**
 * The escape hatch: the selected scenario as YAML. Anything the form doesn't
 * model is still editable here, and nothing is ever silently dropped — the form
 * mutates the parsed scenario in place and the server rewrites only what
 * changed.
 */
function rawCard(sc, index, ctx) {
  let draft = null;
  const area = el("textarea.mono", {
    rows: 14,
    spellcheck: "false",
    $: { value: ctx.toYaml(sc) },
    oninput: (e) => {
      draft = e.target.value;
    },
  });
  const status = el("span.field-hint", {}, "");

  return el("details.card", {}, [
    el("summary", { style: { padding: "8px 10px" } }, "This scenario as YAML"),
    el("div.card-body", {}, [
      area,
      el("div.row-flex", { style: { marginTop: "6px" } }, [
        button("Apply YAML", {
          class: "btn-small",
          onclick: () => {
            if (draft === null) return;
            const parsed = ctx.fromYaml(draft);
            if (parsed.error) {
              status.textContent = parsed.error;
              status.className = "err-text";
              return;
            }
            ctx.model.scenarios[index] = parsed.value;
            draft = null;
            ctx.edit({ structural: true });
          },
        }),
        status,
      ]),
    ]),
  ]);
}

// ── Lab-level settings ───────────────────────────────────────────────────────

/**
 * The Lab tab: everything above `scenarios:`. Pace profiles come first because
 * they are what the output editor's delay dropdown offers — adding a profile
 * here immediately makes it selectable on every line.
 */
function labEditor(ctx) {
  const model = ctx.model;
  const metadata = ensureObject(model, "metadata");
  const settings = ensureObject(model, "settings");

  return [
    card("Metadata", [
      el("div.grid.grid-2", {}, [
        field(
          "id",
          text(metadata.id ?? "", {
            class: "mono",
            oninput: (e) => {
              setOrDelete(metadata, "id", e.target.value);
              ctx.edit({ structural: false });
            },
          }),
        ),
        field(
          "title",
          text(metadata.title ?? "", {
            oninput: (e) => {
              setOrDelete(metadata, "title", e.target.value);
              ctx.edit({ structural: false });
            },
          }),
        ),
      ]),
      field(
        "summary",
        text(metadata.summary ?? "", {
          oninput: (e) => {
            setOrDelete(metadata, "summary", e.target.value);
            ctx.edit({ structural: false });
          },
        }),
      ),
    ]),

    card("Pace profiles", [
      el(
        "div.statelist",
        {},
        Object.entries(ensureObject(settings, "pace")).map(([name, ms]) =>
          el("div.pair", {}, [
            text(name, {
              class: "mono",
              onchange: (e) => {
                const next = e.target.value.trim();
                const pace = settings.pace;
                if (!next || next === name) return;
                const value = pace[name];
                delete pace[name];
                pace[next] = value;
                ctx.edit({ structural: true });
              },
            }),
            el("input.mono", {
              type: "number",
              min: "0",
              step: "50",
              $: { value: ms },
              onchange: (e) => {
                settings.pace[name] = Number(e.target.value);
                ctx.edit({ structural: true });
              },
            }),
            iconButton(
              "✕",
              "Remove this profile",
              () => {
                delete settings.pace[name];
                setOrDelete(settings, "pace", settings.pace);
                ctx.edit({ structural: true });
              },
              "btn-danger",
            ),
          ]),
        ),
      ),
      el("div.row-flex", { style: { marginTop: "6px" } }, [
        button("+ profile", {
          class: "btn-small",
          onclick: () => {
            ensureObject(settings, "pace")[
              uniqueId("beat", Object.keys(settings.pace ?? {}))
            ] = 300;
            ctx.edit({ structural: true });
          },
        }),
        el(
          "span.field-hint",
          {},
          "short (250), medium (700) and long (1400) always exist. Retune one by declaring it here.",
        ),
      ]),
    ]),

    card("Streaming", [
      el("div.grid.grid-3", {}, [
        field(
          "streaming",
          select(
            [
              { value: "", label: "on (default)" },
              { value: "false", label: "off — render at once" },
            ],
            settings.streaming === false ? "false" : "",
            {
              onchange: (e) => {
                if (e.target.value === "false") settings.streaming = false;
                else delete settings.streaming;
                ctx.edit({ structural: true });
              },
            },
          ),
          "Off collapses every delay to zero.",
        ),
        field(
          "per-line delay (ms)",
          el("input.mono", {
            type: "number",
            min: "0",
            placeholder: "20",
            $: { value: settings.streamDelayMs ?? "" },
            onchange: (e) => {
              const v = e.target.value;
              if (v === "") delete settings.streamDelayMs;
              else settings.streamDelayMs = Number(v);
              ctx.edit({ structural: true });
            },
          }),
        ),
        field(
          "agent think (ms)",
          el("input.mono", {
            type: "number",
            min: "0",
            placeholder: "700",
            $: { value: settings.agentThinkMs ?? "" },
            onchange: (e) => {
              const v = e.target.value;
              if (v === "") delete settings.agentThinkMs;
              else settings.agentThinkMs = Number(v);
              ctx.edit({ structural: true });
            },
          }),
        ),
      ]),
    ]),

    card("Unmatched fallbacks", [
      el("div.field-hint", { style: { marginBottom: "8px" } }, [
        "What a learner sees after every scenario fails to match and no built-in (",
        el("code", {}, "ls"),
        ", ",
        el("code", {}, "cat"),
        ") applies.",
      ]),
      ...["unmatched", "unmatchedAgent"].map((key) => {
        const defaults = ensureObject(model, "defaults");
        const block = ensureObject(defaults, key);
        return el("div", { style: { marginBottom: "10px" } }, [
          el(
            "label",
            {},
            key === "unmatched"
              ? "unmatched command"
              : "unmatched agent prompt",
          ),
          outputRowsEditor(
            block,
            key === "unmatched" ? "stderr" : "output",
            ctx,
            {
              when: {},
              then: block,
            },
          ),
          key === "unmatched"
            ? field(
                "exit code",
                el("input.mono", {
                  type: "number",
                  $: { value: block.exit ?? "" },
                  placeholder: "1",
                  onchange: (e) => {
                    const v = e.target.value;
                    if (v === "") delete block.exit;
                    else block.exit = Number(v);
                    ctx.edit({ structural: true });
                  },
                }),
              )
            : null,
        ]);
      }),
    ]),

    controlsCard(ctx),
    workflowsCard(ctx),
    seedStateCard(ctx),
  ];
}

function controlsCard(ctx) {
  const controls = Array.isArray(ctx.model.controls) ? ctx.model.controls : [];
  const write = () => {
    setOrDelete(ctx.model, "controls", controls);
    ctx.edit({ structural: true });
  };
  return card("Controls (toggles in the Settings dialog)", [
    ...controls.map((c, i) =>
      el("div.card", {}, [
        el("div.card-body", {}, [
          el("div.grid.grid-2", {}, [
            field(
              "id",
              text(c.id ?? "", {
                class: "mono",
                oninput: (e) => {
                  c.id = e.target.value;
                  ctx.edit({ structural: false });
                },
              }),
            ),
            field(
              "state path",
              el("input.mono", {
                type: "text",
                list: "state-paths",
                $: { value: c.state ?? "" },
                oninput: (e) => {
                  c.state = e.target.value;
                  ctx.edit({ structural: false });
                },
                onchange: () => ctx.edit({ structural: true }),
              }),
            ),
          ]),
          field(
            "label",
            text(c.label ?? "", {
              oninput: (e) => {
                c.label = e.target.value;
                ctx.edit({ structural: false });
              },
            }),
          ),
          field(
            "description",
            text(c.description ?? "", {
              oninput: (e) => {
                setOrDelete(c, "description", e.target.value);
                ctx.edit({ structural: false });
              },
            }),
          ),
          el("div.grid.grid-2", {}, [
            field(
              "value when on",
              text(formatValue(c.enabled ?? true), {
                class: "mono",
                onchange: (e) => {
                  c.enabled = parseValue(e.target.value);
                  ctx.edit({ structural: true });
                },
              }),
            ),
            field(
              "value when off",
              text(formatValue(c.disabled ?? false), {
                class: "mono",
                onchange: (e) => {
                  c.disabled = parseValue(e.target.value);
                  ctx.edit({ structural: true });
                },
              }),
            ),
          ]),
          iconButton(
            "✕",
            "Remove this control",
            () => {
              controls.splice(i, 1);
              write();
            },
            "btn-danger",
          ),
        ]),
      ]),
    ),
    button("+ control", {
      class: "btn-small",
      onclick: () => {
        controls.push({
          id: uniqueId(
            "control",
            controls.map((c) => c.id),
          ),
          label: "",
          state: "",
          enabled: true,
          disabled: false,
        });
        write();
      },
    }),
  ]);
}

function workflowsCard(ctx) {
  const workflows = Array.isArray(ctx.model.workflows)
    ? ctx.model.workflows
    : [];
  const write = () => {
    setOrDelete(ctx.model, "workflows", workflows);
    ctx.edit({ structural: true });
  };
  return card("CI workflows", [
    ...workflows.map((w, i) =>
      el("details.card", { open: false }, [
        el(
          "summary",
          { style: { padding: "8px 10px" } },
          `${w.id} — ${(w.steps ?? []).length} steps`,
        ),
        el("div.card-body", {}, [
          el("div.grid.grid-3", {}, [
            field(
              "id",
              text(w.id ?? "", {
                class: "mono",
                oninput: (e) => {
                  w.id = e.target.value;
                  ctx.edit({ structural: false });
                },
                onchange: () => ctx.edit({ structural: true }),
              }),
            ),
            field(
              "name",
              text(w.name ?? "", {
                oninput: (e) => {
                  setOrDelete(w, "name", e.target.value);
                  ctx.edit({ structural: false });
                },
              }),
            ),
            field(
              "on",
              text(w.on ?? "", {
                class: "mono",
                placeholder: "push",
                oninput: (e) => {
                  setOrDelete(w, "on", e.target.value);
                  ctx.edit({ structural: false });
                },
              }),
            ),
          ]),
          el("label", { style: { marginTop: "8px" } }, "steps"),
          ...ensureArray(w, "steps").map((step, si) =>
            el("div.card", {}, [
              el("div.card-body", {}, [
                el("div.grid.grid-2", {}, [
                  field(
                    "id",
                    text(step.id ?? "", {
                      class: "mono",
                      oninput: (e) => {
                        step.id = e.target.value;
                        ctx.edit({ structural: false });
                      },
                      onchange: () => ctx.edit({ structural: true }),
                    }),
                  ),
                  field(
                    "requires (state path, must be truthy)",
                    el("input.mono", {
                      type: "text",
                      list: "state-paths",
                      $: { value: step.requires ?? "" },
                      oninput: (e) => {
                        setOrDelete(step, "requires", e.target.value);
                        ctx.edit({ structural: false });
                      },
                      onchange: () => ctx.edit({ structural: true }),
                    }),
                  ),
                ]),
                field(
                  "name",
                  text(step.name ?? "", {
                    oninput: (e) => {
                      setOrDelete(step, "name", e.target.value);
                      ctx.edit({ structural: false });
                    },
                  }),
                ),
                linesField("logs", step, "logs", ctx),
                step.requires
                  ? el("div", {}, [
                      el("label", {}, "failure (when requires is unmet)"),
                      field(
                        "error",
                        text(step.failure?.error ?? "", {
                          oninput: (e) => {
                            const failure = ensureObject(step, "failure");
                            setOrDelete(failure, "error", e.target.value);
                            setOrDelete(step, "failure", failure);
                            ctx.edit({ structural: false });
                          },
                        }),
                      ),
                      linesField(
                        "failure logs",
                        ensureObject(step, "failure"),
                        "logs",
                        ctx,
                      ),
                    ])
                  : null,
                iconButton(
                  "✕",
                  "Remove this step",
                  () => {
                    w.steps.splice(si, 1);
                    write();
                  },
                  "btn-danger",
                ),
              ]),
            ]),
          ),
          el("div.row-flex", {}, [
            button("+ step", {
              class: "btn-small",
              onclick: () => {
                ensureArray(w, "steps").push({
                  id: uniqueId(
                    "step",
                    (w.steps ?? []).map((s) => s.id),
                  ),
                  name: "",
                  logs: [],
                });
                write();
              },
            }),
            iconButton(
              "🗑",
              "Remove this workflow",
              () => {
                workflows.splice(i, 1);
                write();
              },
              "btn-danger",
            ),
          ]),
        ]),
      ]),
    ),
    button("+ workflow", {
      class: "btn-small",
      onclick: () => {
        workflows.push({
          id: uniqueId(
            "workflow",
            workflows.map((w) => w.id),
          ),
          name: "",
          on: "push",
          steps: [],
        });
        write();
      },
    }),
  ]);
}

/**
 * The seed state, edited as YAML rather than as a form: it is a free-shaped
 * tree, and an author reads it as one block. The scenario forms offer its
 * dot-paths as completions, which is what makes them typo-proof.
 */
function seedStateCard(ctx) {
  let draft = null;
  const status = el("span.field-hint", {}, "");
  const area = el("textarea.mono", {
    rows: 12,
    spellcheck: "false",
    $: { value: ctx.toYaml(ctx.model.state ?? {}) },
    oninput: (e) => {
      draft = e.target.value;
    },
  });

  return card("Initial state", [
    el(
      "div.field-hint",
      { style: { marginBottom: "6px" } },
      "Reset restores exactly this. Dot-paths from here are offered as completions everywhere else.",
    ),
    area,
    el("div.row-flex", { style: { marginTop: "6px" } }, [
      button("Apply state", {
        class: "btn-small",
        onclick: () => {
          if (draft === null) return;
          const parsed = ctx.fromYaml(draft);
          if (parsed.error) {
            status.textContent = parsed.error;
            status.className = "err-text";
            return;
          }
          setOrDelete(ctx.model, "state", parsed.value ?? {});
          draft = null;
          ctx.edit({ structural: true });
        },
      }),
      status,
    ]),
  ]);
}
