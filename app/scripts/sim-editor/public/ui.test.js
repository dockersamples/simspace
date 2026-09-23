// @vitest-environment jsdom
//
// A smoke test that drives the real UI.
//
// The editor's browser code has no other net: there is no component suite for
// it and no browser in CI. What this covers is the path that can silently lose
// an author's work — a form edit turning into a model change turning into the
// bytes the patcher writes — plus the wiring that would throw on load. It uses
// the REAL index.html markup and the REAL sample lab, with only `fetch` stubbed,
// so a renamed element id or a broken import fails here.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseManifest } from "@dockersamples/simspace-simulator";
import { analyze, scenarioComments } from "../analyze.ts";
import { lint } from "../lint.ts";
import { patchYaml } from "../patch.ts";

const HERE = import.meta.dirname;
const SPEC_PATH = join(
  HERE,
  "../../../public/labs/tour-of-docker/simulator.yaml",
);
const SPEC = readFileSync(SPEC_PATH, "utf8");

/** The doc payload the server would send, built the way the server builds it. */
function docPayload(model = parse(SPEC)) {
  const lab = parseManifest(SPEC);
  const analysis = analyze(lab);
  return {
    path: SPEC_PATH,
    relPath: "public/labs/tour-of-docker/simulator.yaml",
    text: SPEC,
    model,
    mtimeMs: 1000,
    analysis,
    findings: lint(lab, { analysis }),
    comments: scenarioComments(SPEC.split("\n")),
    context: {
      labIds: ["tour-of-docker"],
      title: "A Tour of Docker",
      shared: false,
      terminalIds: ["host", "sandbox"],
      stepIds: ["run-container", "stop-container"],
      files: ["server.js"],
    },
    session: null,
  };
}

const calls = [];

function stubFetch() {
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const reply = (data, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => data,
    });

    if (String(url).startsWith("/api/files")) {
      return reply({
        files: [
          {
            path: SPEC_PATH,
            relPath: "public/labs/tour-of-docker/simulator.yaml",
            title: "A Tour of Docker",
            labIds: ["tour-of-docker"],
            shared: false,
          },
        ],
      });
    }
    if (String(url).startsWith("/api/doc")) return reply(docPayload());
    if (String(url).startsWith("/api/analyze")) {
      // Analyse the EDITED model, as the server does.
      const { stringify } = await import("yaml");
      const lab = parseManifest(stringify(body.model));
      const analysis = analyze(lab);
      return reply({ analysis, findings: lint(lab, { analysis }) });
    }
    if (String(url).startsWith("/api/preview")) {
      const result = patchYaml(SPEC, body.model);
      return reply({
        strategy: result.strategy,
        changes: result.changes,
        diff: result.text === SPEC ? "" : "@@ -1,1 +1,1 @@\n-old\n+new",
      });
    }
    if (String(url).startsWith("/api/save")) {
      const result = patchYaml(SPEC, body.model);
      return reply({
        strategy: result.strategy,
        changes: result.changes,
        backup: "/tmp/backup.yaml",
        doc: docPayload(parse(result.text)),
      });
    }
    if (String(url).startsWith("/api/run")) {
      return reply({
        matched: "docker-ps-empty",
        exit: 0,
        lines: [
          { text: "CONTAINER ID   IMAGE", stream: "stdout" },
          { text: "a warning", stream: "stderr" },
        ],
        changed: [{ path: "container.running", before: false, after: true }],
        state: { container: { running: true } },
        files: {},
        history: ["docker ps"],
      });
    }
    if (String(url).startsWith("/api/reset")) {
      return reply({ state: {}, files: {}, history: [] });
    }
    return reply({ error: `unstubbed ${url}` }, 404);
  });
}

/** Lets pending promises and debounced work settle. */
async function settle(ms = 400) {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Finds a control by its visible label text within a card. */
function labelled(label) {
  const node = $$("label").find((l) => l.textContent.trim() === label);
  return node?.nextElementSibling ?? null;
}

function buttonWith(text, root = document) {
  return [...root.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text,
  );
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

beforeAll(async () => {
  const html = readFileSync(join(HERE, "index.html"), "utf8");
  document.body.innerHTML = html
    .slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
    .replace(/<script[\s\S]*?<\/script>/g, "");
  stubFetch();
  // jsdom has no layout, so rAF callbacks (focus, scroll) need to run.
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.confirm = () => true;
  await import("./app.js");
  await settle();
});

describe("loading", () => {
  it("lists every scenario, numbered in match order", () => {
    const rows = $$("#list .row");
    expect(rows.length).toBe(parse(SPEC).scenarios.length);
    expect(rows[0].querySelector(".row-index").textContent).toBe("1");
    expect(rows[0].querySelector(".row-id").textContent).toBe("docker-run");
    expect(rows[0].classList.contains("is-selected")).toBe(true);
  });

  it("keeps the author's section banners as dividers", () => {
    const dividers = $$("#list .divider").map((d) => d.textContent);
    expect(dividers.length).toBeGreaterThanOrEqual(4);
    expect(dividers.join("\n")).toContain("SECTION 1");
    expect(dividers.join("\n")).toContain("SECTION 4");
  });

  it("shows the trigger and the state tags on each row", () => {
    const first = $$("#list .row")[0];
    expect(first.querySelector(".row-trigger").textContent).toBe(
      "docker run --name=*",
    );
    const tags = [...first.querySelectorAll(".tag")].map((t) => t.textContent);
    expect(tags).toEqual(
      expect.arrayContaining(["needs 1", "sets 3", "✓ run-container"]),
    );
  });

  it("starts clean — nothing to save, nothing to undo", () => {
    expect($("#dirty").hidden).toBe(true);
    expect($("#review").disabled).toBe(true);
    expect($("#undo").disabled).toBe(true);
  });
});

describe("the selected scenario", () => {
  it("shows its identity, pre-state and post-state", () => {
    expect(labelled("id").value).toBe("docker-run");
    const chips = $$("#editor .chip").map((c) => c.textContent);
    expect(chips).toEqual(
      expect.arrayContaining([
        "container.running: false",
        "container.running: true",
      ]),
    );
  });

  it("offers the labspace's terminals and steps rather than free text", () => {
    const terminal = labelled("terminal");
    expect([...terminal.options].map((o) => o.value)).toEqual([
      "",
      "host",
      "sandbox",
    ]);
    const completes = labelled("completes (progress step)");
    expect([...completes.options].map((o) => o.value)).toEqual([
      "",
      "run-container",
      "stop-container",
    ]);
    expect(completes.value).toBe("run-container");
  });

  it("lists the scenarios that answer the same command, in order", () => {
    // docker-run-conflict also matches `docker run`.
    const jumpTargets = $$("#editor .chip-link").map((c) => c.textContent);
    expect(jumpTargets.join(" ")).toContain("docker-run-conflict");
  });

  it("renders every output line with its delay", () => {
    const rows = $$("#editor .out");
    expect(rows.length).toBe(6);
    const delays = rows.map(
      (r) => r.querySelector("select,input[type=number]")?.value,
    );
    expect(delays).toEqual(["", "beat", "pull", "beat", "", "beat"]);
    const texts = rows.map((r) => r.querySelector(".out-text")?.value);
    expect(texts[0]).toBe("Unable to find image 'nginx:latest' locally");
  });

  it("names the captures a template can use", () => {
    expect($("#editor").textContent).toContain("captures: {{ args.name }}");
  });
});

describe("editing", () => {
  it("marks the document dirty and enables saving", async () => {
    const firstOutput = $$("#editor .out .out-text")[0];
    type(firstOutput, "Unable to find image 'nginx:1.27' locally");
    expect($("#dirty").hidden).toBe(false);
    expect($("#review").disabled).toBe(false);
    await settle();
  });

  it("sends the edited model to the patcher, and it lands in the YAML", async () => {
    calls.length = 0;
    buttonWith("Review & save").click();
    await settle(50);

    const preview = calls.find((c) => c.url.includes("/api/preview"));
    expect(preview).toBeTruthy();
    const result = patchYaml(SPEC, preview.body.model);
    expect(result.strategy).toBe("splice");
    expect(result.text).toContain("Unable to find image 'nginx:1.27' locally");
    // And nothing else moved.
    expect(result.changes).toEqual([
      {
        path: "scenarios[0].then.output[0]",
        kind: "set",
        note: undefined,
      },
    ]);
  });

  it("shows the diff in a modal before writing anything", () => {
    expect($(".modal-backdrop")).toBeTruthy();
    expect($(".modal-title").textContent).toContain("simulator.yaml");
    expect($(".diff")).toBeTruthy();
    buttonWith("Cancel", $(".modal")).click();
    expect($(".modal-backdrop")).toBeFalsy();
  });

  it("adds an output line", async () => {
    const before = $$("#editor .out").length;
    buttonWith("+ line", $("#editor")).click();
    await settle(0);
    expect($$("#editor .out").length).toBe(before + 1);
  });

  it("adds a pause entry that prints nothing", async () => {
    buttonWith("+ pause", $("#editor")).click();
    await settle(0);
    const pauses = $$("#editor .out.is-pause");
    expect(pauses.length).toBe(1);
    expect(pauses[0].textContent).toContain("prints nothing");
  });

  it("undoes the last change", async () => {
    expect($("#undo").disabled).toBe(false);
    $("#undo").click();
    await settle(0);
    expect($$("#editor .out.is-pause").length).toBe(0);
  });

  it("reverts everything back to the file", async () => {
    $("#revert").click();
    await settle();
    expect($("#dirty").hidden).toBe(true);
    expect(
      $$("#editor .out")[0].value ?? $$("#editor .out .out-text")[0].value,
    ).toBe("Unable to find image 'nginx:latest' locally");
  });
});

describe("reordering", () => {
  it("moves a scenario down and keeps it selected", async () => {
    const ids = () => $$("#list .row .row-id").map((n) => n.textContent);
    const before = ids();
    buttonWith("↓", $("#editor"))?.click();
    await settle(0);
    const after = ids();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect($$("#list .row")[1].classList.contains("is-selected")).toBe(true);
    $("#revert").click();
    await settle();
  });
});

describe("filtering and navigation", () => {
  it("filters the list by command as well as by id", async () => {
    type($("#filter"), "compose");
    await settle(200);
    const ids = $$("#list .row .row-id").map((n) => n.textContent);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.includes("compose"))).toBe(true);
    type($("#filter"), "");
    await settle(200);
  });

  it("switches to the state map and shows every touchpoint of a path", async () => {
    $$("[data-list]")
      .find((t) => t.dataset.list === "state")
      .click();
    await settle(0);
    const text = $("#list").textContent;
    expect(text).toContain("container.running");
    expect(text).toContain("read by");
    expect(text).toContain("written by");
    $$("[data-list]")
      .find((t) => t.dataset.list === "scenarios")
      .click();
    await settle(0);
  });
});

describe("the console", () => {
  it("runs a command and reports which scenario answered it", async () => {
    $$("[data-side]")
      .find((t) => t.dataset.side === "console")
      .click();
    await settle(0);
    const input = $(".console-form input");
    input.value = "docker ps";
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle(100);

    const out = $("#console-out").textContent;
    expect(out).toContain("$ docker ps");
    expect(out).toContain("CONTAINER ID   IMAGE");
    expect(out).toContain("matched");
    expect(out).toContain("docker-ps-empty");
    // The state change the run produced is reported under the output.
    expect(out).toContain("container.running");
  });

  it("warns when a different scenario answered than the one being edited", () => {
    // The selected scenario is docker-run; the stub matched docker-ps-empty.
    expect($("#console-out").textContent).toContain(
      "which is the one you were editing",
    );
  });
});

describe("checks", () => {
  it("lists the live findings and links them to their scenario", async () => {
    $$("[data-side]")
      .find((t) => t.dataset.side === "checks")
      .click();
    await settle(0);
    const panel = $("#side").textContent;
    expect(panel).toContain("Live checks");
    expect(panel).toContain("validate-lab");
  });
});

describe("the lab tab", () => {
  it("edits a pace profile, and the delay dropdowns pick it up", async () => {
    $$("[data-list]")
      .find((t) => t.dataset.list === "lab")
      .click();
    await settle(0);
    expect($("#editor").textContent).toContain("Pace profiles");

    buttonWith("+ profile", $("#editor")).click();
    await settle();

    $$("[data-list]")
      .find((t) => t.dataset.list === "scenarios")
      .click();
    await settle(0);
    $$("#list .row")[0].click();
    await settle(0);

    const options = [...$("#editor .out select").options].map((o) => o.value);
    expect(options).toContain("beat");
    $("#revert").click();
    await settle();
  });
});

describe("adding a scenario", () => {
  it("inserts it after the selected one and writes a well-formed block", async () => {
    $$("#list .row")[0].click();
    await settle(0);
    const before = $$("#list .row").length;

    buttonWith("+ Command").click();
    await settle();

    expect($$("#list .row").length).toBe(before + 1);
    const rows = $$("#list .row .row-id").map((n) => n.textContent);
    expect(rows[1]).toBe("new-command");
    expect($$("#list .row")[1].classList.contains("is-selected")).toBe(true);

    // Fill it in the way an author would.
    type(labelled("id"), "docker-version");
    type(labelled("command"), "docker version");
    type(
      $$("#editor .out .out-text")[0],
      "Docker version 27.3.1, build ce12230",
    );
    await settle();

    calls.length = 0;
    buttonWith("Review & save").click();
    await settle(50);
    const preview = calls.find((c) => c.url.includes("/api/preview"));
    const result = patchYaml(SPEC, preview.body.model);

    expect(result.strategy).toBe("splice");
    expect(result.text).toContain("  - id: docker-version\n");
    expect(result.text).toContain("      command: docker version\n");
    // A one-line output list is flow in these labs, and so is the one the
    // editor writes.
    expect(result.text).toContain(
      '      output: ["Docker version 27.3.1, build ce12230"]\n',
    );
    // It landed second, right after the scenario that was selected.
    const savedIds = parse(result.text).scenarios.map((s) => s.id);
    expect(savedIds.slice(0, 3)).toEqual([
      "docker-run",
      "docker-version",
      "docker-run-conflict",
    ]);

    buttonWith("Cancel", $(".modal")).click();
    $("#revert").click();
    await settle();
  });

  it("switches a scenario to an agent prompt and swaps the fields", async () => {
    buttonWith("+ Agent prompt").click();
    await settle();

    expect(labelled("matches").value).toBe("agent");
    expect(labelled("prompt match")).toBeTruthy();
    expect(labelled("command")).toBeFalsy();

    type(
      labelled("keywords (comma separated, case-insensitive, all must appear)"),
      "health, endpoint",
    );
    await settle();

    calls.length = 0;
    buttonWith("Review & save").click();
    await settle(50);
    const preview = calls.find((c) => c.url.includes("/api/preview"));
    const added = preview.body.model.scenarios.find(
      (s) => s.id === "agent-turn",
    );
    expect(added.when).toEqual({
      agent: true,
      promptContains: ["health", "endpoint"],
    });

    buttonWith("Cancel", $(".modal")).click();
    $("#revert").click();
    await settle();
  });
});
