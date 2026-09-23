// The left pane: three lists that share one rule — everything is shown in the
// order the engine sees it.
//
// The scenario list is numbered because the number IS the priority, keeps the
// author's own comment banners as section dividers (so a 30-scenario file reads
// the way its author organized it), and is drag-reorderable, because reordering
// is the fix for half of the problems the editor reports.

import { el, fill, iconButton } from "./dom.js";
import { moveItem, summaryTags } from "./model.js";

export function renderList(root, ctx) {
  if (ctx.listTab === "state") return fill(root, stateList(ctx));
  if (ctx.listTab === "lab") return fill(root, labList(ctx));
  return fill(root, scenarioList(root, ctx));
}

function scenarioList(root, ctx) {
  const scenarios = ctx.model.scenarios ?? [];
  const filter = ctx.filter.trim().toLowerCase();
  const nodes = [];
  let lastBanner = null;

  scenarios.forEach((sc, index) => {
    const summary = ctx.analysis?.scenarios?.[index];
    const comments = ctx.comments?.[index] ?? {};
    const trigger = summary?.trigger ?? "";
    const haystack = [
      sc.id,
      trigger,
      sc.description,
      sc.completes,
      ...(summary?.requires ?? []).map((p) => p.path),
      ...(summary?.sets ?? []).map((p) => p.path),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (filter && !haystack.includes(filter)) return;

    // The author's banner comments become dividers, so the list keeps the shape
    // the file has. Only shown when the section actually has a visible row.
    if (comments.banner && comments.banner !== lastBanner) {
      nodes.push(el("div.divider", {}, comments.banner));
      lastBanner = comments.banner;
    }

    const findings = (ctx.findings ?? []).filter((f) => f.scenario === sc.id);
    const worst = findings.some((f) => f.severity === "error")
      ? "error"
      : findings.length
        ? "warning"
        : null;

    nodes.push(
      el(
        `div.row${ctx.selection.kind === "scenario" && ctx.selection.index === index ? ".is-selected" : ""}`,
        {
          role: "listitem",
          draggable: "true",
          "data-index": String(index),
          onclick: () => ctx.select({ kind: "scenario", index }),
          title: sc.description ?? comments.note ?? "",
        },
        [
          el("div.row-index", {}, String(index + 1)),
          el("div", {}, [
            el("div.row-id", {}, sc.id || el("span.err-text", {}, "(no id)")),
            el("div.row-trigger", {}, trigger),
            el("div.row-tags", {}, [
              ...summaryTags(
                summary ?? {
                  kind: "command",
                  requires: [],
                  sets: [],
                  effects: [],
                },
              ).map((tag) =>
                el(
                  `span.tag${tag.cls ? `.${tag.cls}` : ""}`,
                  { title: tag.title },
                  tag.text,
                ),
              ),
              worst
                ? el(
                    `span.tag.tag-${worst === "error" ? "err" : "warn"}`,
                    { title: findings.map((f) => f.message).join("\n") },
                    worst === "error" ? "error" : "check",
                  )
                : null,
            ]),
          ]),
        ],
      ),
    );
  });

  if (!nodes.length) {
    nodes.push(
      el(
        "div.empty",
        {},
        filter ? `Nothing matches “${ctx.filter}”.` : "No scenarios yet.",
      ),
    );
  }

  const container = el("div", {}, nodes);
  // Dragging reorders, which changes which scenario wins a match — the single
  // most consequential edit in the file, and the hardest to do by hand.
  ctx.enableDrag(container, (from, to) => {
    moveItem(ctx.model.scenarios, from, to);
    ctx.select({ kind: "scenario", index: to });
    ctx.edit({ structural: true });
  });
  return container;
}

/**
 * The state list: every dot-path in the lab with its seed value and everything
 * that touches it. This is the answer to "can I change this precondition?" —
 * you can see who else depends on the path before you touch it.
 */
function stateList(ctx) {
  const facts = ctx.analysis?.state ?? [];
  const filter = ctx.filter.trim().toLowerCase();
  const session = ctx.sessionState;

  const rows = facts
    .filter((f) => !filter || f.path.toLowerCase().includes(filter))
    .map((fact) => {
      const live = session ? valueAt(session, fact.path) : undefined;
      const drifted =
        session !== null &&
        live !== undefined &&
        JSON.stringify(live) !== JSON.stringify(fact.seed);

      const touch = (label, ids) =>
        ids.length
          ? el("div.fact-meta", {}, [
              `${label}: `,
              ...ids.map((id) =>
                el(
                  "span.chip.chip-link",
                  {
                    onclick: (e) => {
                      e.stopPropagation();
                      ctx.jumpToScenario(id.split("/")[0]);
                    },
                  },
                  id,
                ),
              ),
            ])
          : null;

      return el("div.fact", {}, [
        el("div.row-flex", {}, [
          el("span.fact-path", {}, fact.path),
          fact.seeded
            ? el("span.chip", {}, `seed: ${render(fact.seed)}`)
            : el(
                "span.chip.fact-warn",
                { title: "not in the state: seed" },
                "not seeded",
              ),
          drifted
            ? el(
                "span.chip",
                { title: "current console value" },
                `now: ${render(live)}`,
              )
            : null,
        ]),
        touch("read by", fact.readers),
        touch("written by", fact.writers),
        touch("toggled by", fact.controls),
        touch("required by", fact.requiredBy),
        !fact.readers.length && !fact.requiredBy.length && fact.writers.length
          ? el("div.fact-meta.fact-warn", {}, "nothing reads this")
          : null,
        fact.readers.length &&
        !fact.seeded &&
        !fact.writers.length &&
        !fact.controls.length
          ? el(
              "div.fact-meta.fact-warn",
              {},
              "read but never written — likely a typo",
            )
          : null,
      ]);
    });

  return [
    el(
      "div.divider",
      {},
      `${facts.length} state path${facts.length === 1 ? "" : "s"}`,
    ),
    ...(rows.length ? rows : [el("div.empty", {}, "No state paths.")]),
  ];
}

function labList(ctx) {
  const model = ctx.model;
  const counts = [
    ["Scenarios", (model.scenarios ?? []).length],
    ["Controls", (model.controls ?? []).length],
    ["CI workflows", (model.workflows ?? []).length],
    ["Pace profiles", Object.keys(model.settings?.pace ?? {}).length],
    ["Objectives", (model.objectives ?? []).length],
  ];

  return [
    el(
      `div.row${ctx.selection.kind === "lab" ? ".is-selected" : ""}`,
      { onclick: () => ctx.select({ kind: "lab" }) },
      [
        el("div.row-index", {}, "⚙"),
        el("div", {}, [
          el("div.row-id", {}, model.metadata?.title ?? "Lab settings"),
          el(
            "div.row-trigger",
            {},
            `version ${model.version ?? "?"} · ${(model.scenarios ?? []).length} scenarios`,
          ),
        ]),
      ],
    ),
    el("div.divider", {}, "contents"),
    ...counts.map(([label, n]) =>
      el("div.fact", {}, [
        el("div.row-flex", {}, [
          el("span.fact-path", {}, label),
          el("span.chip", {}, String(n)),
        ]),
      ]),
    ),
    el("div.divider", {}, "context"),
    el("div.fact", {}, [
      el("div.fact-meta", {}, `file: ${ctx.doc?.relPath ?? ""}`),
      ctx.context?.labIds?.length
        ? el(
            "div.fact-meta",
            {},
            `used by: ${ctx.context.labIds.join(", ")}${ctx.context.shared ? " (shared)" : ""}`,
          )
        : el(
            "div.fact-meta.fact-warn",
            {},
            "no labspace.yaml references this spec",
          ),
      ctx.context?.terminalIds?.length
        ? el(
            "div.fact-meta",
            {},
            `terminals: ${ctx.context.terminalIds.join(", ")}`,
          )
        : null,
      ctx.context?.stepIds?.length
        ? el("div.fact-meta", {}, `steps: ${ctx.context.stepIds.join(", ")}`)
        : null,
      ctx.context?.files?.length
        ? el("div.fact-meta", {}, `seed files: ${ctx.context.files.join(", ")}`)
        : null,
    ]),
  ];
}

function valueAt(tree, path) {
  let node = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

function render(value) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value === "" ? '""' : value;
  return JSON.stringify(value);
}

export { iconButton };
