// The patcher rewrites an author's hand-formatted simulator.yaml, so these
// tests care about two things at once: that the result MEANS what the editor
// intended (parse it back and compare), and that it left everything else alone
// (line-for-line).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { patchYaml, type Json } from "./patch";

const LAB = join(
  import.meta.dirname,
  "../../public/labs/tour-of-docker/simulator.yaml",
);

/** Lines that differ between two texts, as a unified-ish list of markers. */
function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];
  // Cheap LCS-free comparison: collect lines absent from the other side.
  const bCounts = new Map<string, number>();
  for (const line of b) bCounts.set(line, (bCounts.get(line) ?? 0) + 1);
  const aCounts = new Map<string, number>();
  for (const line of a) aCounts.set(line, (aCounts.get(line) ?? 0) + 1);
  for (const [line, n] of aCounts) {
    const m = bCounts.get(line) ?? 0;
    for (let i = 0; i < n - m; i++) out.push(`- ${line}`);
  }
  for (const [line, n] of bCounts) {
    const m = aCounts.get(line) ?? 0;
    for (let i = 0; i < n - m; i++) out.push(`+ ${line}`);
  }
  return out;
}

/** Apply an edit to the parsed model and patch the text with the result. */
function edit(text: string, fn: (model: any) => void) {
  const model = parse(text) as Json;
  fn(model);
  const result = patchYaml(text, model);
  // The invariant the whole tool rests on: the file now means the model.
  expect(parse(result.text)).toEqual(model);
  return result;
}

describe("patchYaml", () => {
  it("reports no change when the model matches the file", () => {
    const text = 'version: "2.0"\nscenarios: []\n';
    const result = patchYaml(text, parse(text) as Json);
    expect(result.strategy).toBe("unchanged");
    expect(result.text).toBe(text);
  });

  it("edits a scalar in place, keeping its quote style and the comments around it", () => {
    const text = [
      "# top-of-file note",
      'version: "2.0"',
      "",
      "scenarios:",
      "  # a section banner",
      "  - id: docker-ps # trailing note",
      "    when:",
      "      command: [docker, ps]",
      "    then:",
      "      output:",
      '        - "CONTAINER ID"',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.scenarios[0].then.output[0] = "CONTAINER ID   IMAGE";
    });

    expect(result.strategy).toBe("splice");
    expect(result.text).toBe(
      text.replace('"CONTAINER ID"', '"CONTAINER ID   IMAGE"'),
    );
    expect(result.changes).toEqual([
      { path: "scenarios[0].then.output[0]", kind: "set", note: undefined },
    ]);
  });

  it("keeps a plain scalar plain and quotes only when it has to", () => {
    const text = "when:\n  command: docker ps\n  terminal: host\n";
    const result = edit(text, (m) => {
      m.when.command = "docker compose ps";
      m.when.terminal = "sandbox: main";
    });
    expect(result.text).toBe(
      'when:\n  command: docker compose ps\n  terminal: "sandbox: main"\n',
    );
  });

  it("rewrites a block literal as a block literal at the same indentation", () => {
    const text = [
      "then:",
      "  files:",
      "    - create: app/server.js",
      "      content: |",
      "        const a = 1;",
      "        const b = 2;",
      "  exit: 0",
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.then.files[0].content = "const a = 1;\nconst b = 3;\n";
    });
    expect(result.strategy).toBe("splice");
    expect(result.text).toBe(text.replace("const b = 2;", "const b = 3;"));
  });

  it("turns an output line into a paced entry in the lab's flow style", () => {
    const text = [
      "then:",
      "  output:",
      '    - "Pulling from library/nginx"',
      '    - "Status: Downloaded newer image"',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.then.output[0] = { text: "Pulling from library/nginx", delay: "pull" };
    });
    expect(result.strategy).toBe("splice");
    expect(result.text).toBe(
      [
        "then:",
        "  output:",
        '    - { text: "Pulling from library/nginx", delay: pull }',
        '    - "Status: Downloaded newer image"',
        "",
      ].join("\n"),
    );
  });

  it("adds a pure pause entry and a new output line", () => {
    const text = 'then:\n  output:\n    - "one"\n';
    const result = edit(text, (m) => {
      m.then.output.push({ delay: "long" });
      m.then.output.push("two");
    });
    expect(result.text).toBe(
      [
        "then:",
        "  output:",
        '    - "one"',
        "    - { delay: long }",
        '    - "two"',
        "",
      ].join("\n"),
    );
  });

  it("changes a delay without touching the text beside it", () => {
    const text =
      'output:\n  - { text: "a480a496 ... : Pull complete", delay: pull }\n';
    const result = edit(text, (m) => {
      m.output[0].delay = 1200;
    });
    expect(result.text).toBe(
      'output:\n  - { text: "a480a496 ... : Pull complete", delay: 1200 }\n',
    );
  });

  it("adds a key in the model's own order rather than appending blindly", () => {
    const text = [
      "- id: docker-run",
      "  when:",
      "    command: [docker, run]",
      "  then:",
      '    output: ["started"]',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      // Rebuild the scenario with `description` between `id` and `when`.
      const s = m[0];
      m[0] = {
        id: s.id,
        description: "Start a container",
        when: s.when,
        then: s.then,
      };
    });
    expect(result.text).toBe(
      [
        "- id: docker-run",
        '  description: "Start a container"',
        "  when:",
        "    command: [docker, run]",
        "  then:",
        '    output: ["started"]',
        "",
      ].join("\n"),
    );
  });

  it("removes a key and the comment written above it", () => {
    const text = [
      "then:",
      "  state: { container.running: true }",
      "  # the id docker prints when the container starts",
      '  output: ["3f8a9c2b1d4e"]',
      "  exit: 0",
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      delete m.then.output;
    });
    expect(result.text).toBe(
      ["then:", "  state: { container.running: true }", "  exit: 0", ""].join(
        "\n",
      ),
    );
  });

  it("re-renders a flow map when its shape changes, leaving its line alone otherwise", () => {
    const text = [
      "when:",
      "  command: [docker, run]",
      "  args: { --name: { any: true } }",
      "  state: { container.running: false }",
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.when.args = { "--name": { any: true }, "-d": true };
    });
    expect(result.text).toBe(
      [
        "when:",
        "  command: [docker, run]",
        "  args: { --name: { any: true }, -d: true }",
        "  state: { container.running: false }",
        "",
      ].join("\n"),
    );
  });

  it("keeps a positional arg matcher's key numeric", () => {
    const text = "when:\n  command: [curl]\n  args:\n    0: { any: true }\n";
    const result = edit(text, (m) => {
      m.when.args["0"] = { oneOf: ["localhost:8080", "http://localhost:8080"] };
      m.when.args["1"] = true;
    });
    expect(result.text).toBe(
      [
        "when:",
        "  command: [curl]",
        "  args:",
        '    0: { oneOf: ["localhost:8080", "http://localhost:8080"] }',
        "    1: true",
        "",
      ].join("\n"),
    );
    // And it is still a positional matcher, not the string key "0".
    expect(Object.keys(parse(result.text).when.args)).toEqual(["0", "1"]);
  });

  it("moves a scenario with its comment banner and leaves the others byte-identical", () => {
    const text = [
      "scenarios:",
      "  # ── specific case ──",
      "  - id: ps-running",
      "    when:",
      "      command: [docker, ps]",
      "      state: { container.running: true }",
      "    then:",
      '      output: ["a1b2c3d4  nginx  Up"]',
      "",
      "  # ── the fallback ──",
      "  - id: ps-empty",
      "    when:",
      "      command: [docker, ps]",
      "    then:",
      '      output: ["CONTAINER ID"]',
      "",
      "  - id: docker-stop",
      "    when:",
      "      command: [docker, stop]",
      "    then:",
      '      output: ["web"]',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      const [a, b, c] = m.scenarios;
      m.scenarios = [b, a, c];
    });

    expect(result.strategy).toBe("splice");
    expect(result.text).toBe(
      [
        "scenarios:",
        "  # ── the fallback ──",
        "  - id: ps-empty",
        "    when:",
        "      command: [docker, ps]",
        "    then:",
        '      output: ["CONTAINER ID"]',
        "",
        "  # ── specific case ──",
        "  - id: ps-running",
        "    when:",
        "      command: [docker, ps]",
        "      state: { container.running: true }",
        "    then:",
        '      output: ["a1b2c3d4  nginx  Up"]',
        "",
        "  - id: docker-stop",
        "    when:",
        "      command: [docker, stop]",
        "    then:",
        '      output: ["web"]',
        "",
      ].join("\n"),
    );
  });

  it("inserts a new scenario between two existing ones, keeping the blank-line rhythm", () => {
    const text = [
      "scenarios:",
      "  - id: first",
      "    when:",
      "      command: [docker, ps]",
      "    then:",
      '      output: ["one"]',
      "",
      "  - id: second",
      "    when:",
      "      command: [docker, rm]",
      "    then:",
      '      output: ["two"]',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.scenarios.splice(1, 0, {
        id: "inserted",
        when: { command: "docker stop", state: { "container.running": true } },
        then: { state: { "container.running": false }, output: ["stopped"] },
      });
    });

    expect(result.strategy).toBe("splice");
    const lines = result.text.split("\n");
    expect(lines.slice(0, 7).join("\n")).toBe(
      text.split("\n").slice(0, 7).join("\n"),
    );
    expect(result.text).toContain("  - id: inserted\n");
    expect(result.text).toContain("      command: docker stop\n");
    expect(result.text).toContain("  - id: second\n");
  });

  it("deletes a scenario along with its banner and its blank line", () => {
    const text = [
      "scenarios:",
      "  - id: keep-me",
      "    when:",
      "      command: [docker, ps]",
      "    then:",
      '      output: ["one"]',
      "",
      "  # ── remove this whole block ──",
      "  - id: delete-me",
      "    when:",
      "      command: [docker, rm]",
      "    then:",
      '      output: ["two"]',
      "",
      "  - id: keep-me-too",
      "    when:",
      "      command: [docker, stop]",
      "    then:",
      '      output: ["three"]',
      "",
    ].join("\n");

    const result = edit(text, (m) => {
      m.scenarios.splice(1, 1);
    });
    expect(result.text).toBe(
      [
        "scenarios:",
        "  - id: keep-me",
        "    when:",
        "      command: [docker, ps]",
        "    then:",
        '      output: ["one"]',
        "",
        "  - id: keep-me-too",
        "    when:",
        "      command: [docker, stop]",
        "    then:",
        '      output: ["three"]',
        "",
      ].join("\n"),
    );
  });

  it("renames a scenario id and the ids stay unique", () => {
    const text =
      "scenarios:\n  - id: old-name\n    when:\n      command: [ls]\n    then:\n      output: []\n";
    const result = edit(text, (m) => {
      m.scenarios[0].id = "new-name";
    });
    expect(result.text).toContain("- id: new-name");
  });

  it("writes a single-quoted string when the value carries double quotes", () => {
    const text = 'output:\n  - "plain"\n';
    const result = edit(text, (m) => {
      m.output[0] = 'he said "hi"';
    });
    expect(result.text).toBe("output:\n  - 'he said \"hi\"'\n");
  });

  it("keeps a block literal parseable when its first line starts with a space", () => {
    const text = [
      "then:",
      "  files:",
      "    - create: table.txt",
      "      content: |",
      "        header",
      "",
      "",
    ].join("\n");
    const result = edit(text, (m) => {
      m.then.files[0].content = "  indented first line\nflush\n";
    });
    expect(result.strategy).toBe("splice");
    expect(result.text).toContain("      content: |2\n");
  });

  it("adds a nested block when the value is too big for one line", () => {
    const text =
      "- id: agent-turn\n  when:\n    agent: true\n  then:\n    output: []\n";
    const result = edit(text, (m) => {
      m[0].then.files = [
        {
          replace: "server.js",
          find: "app.listen(3000)",
          with: "app.listen(8080)",
        },
      ];
    });
    expect(parse(result.text)[0].then.files[0].with).toBe("app.listen(8080)");
    expect(result.text).toContain("    files:\n");
  });
});

describe("patchYaml against the real lab spec", () => {
  const text = readFileSync(LAB, "utf8");

  it("leaves the file untouched when nothing changed", () => {
    expect(patchYaml(text, parse(text) as Json).strategy).toBe("unchanged");
  });

  it("changes exactly two lines when one output line gains a delay", () => {
    const result = edit(text, (m: any) => {
      const sc = m.scenarios.find((s: any) => s.id === "git-commit");
      sc.then.output[0] = { text: sc.then.output[0], delay: "beat" };
    });
    expect(result.strategy).toBe("splice");
    const diff = changedLines(text, result.text);
    expect(diff).toEqual([
      '-         - "[main c0ffee1] Add build, push and sign workflow"',
      '+         - { text: "[main c0ffee1] Add build, push and sign workflow", delay: beat }',
    ]);
  });

  it("pushes a long paced entry onto its own lines rather than one huge line", () => {
    const result = edit(text, (m: any) => {
      const sc = m.scenarios.find((s: any) => s.id === "docker-ps-running");
      sc.then.output[0] = { text: sc.then.output[0], delay: "beat" };
    });
    expect(result.strategy).toBe("splice");
    const diff = changedLines(text, result.text);
    expect(diff.filter((d) => d.startsWith("-"))).toHaveLength(1);
    expect(diff.filter((d) => d.startsWith("+"))).toHaveLength(2);
    expect(result.text).toContain('        - text: "CONTAINER ID');
    expect(result.text).toContain("          delay: beat\n");
  });

  it("changes only the moved block when a scenario is reordered", () => {
    const result = edit(text, (m: any) => {
      const i = m.scenarios.findIndex((s: any) => s.id === "docker-logs-none");
      const [sc] = m.scenarios.splice(i, 1);
      m.scenarios.splice(i - 1, 0, sc);
    });
    expect(result.strategy).toBe("splice");
    // Same lines, different order: a pure move adds and removes nothing.
    expect(changedLines(text, result.text)).toEqual([]);
    const ids = (parse(result.text) as any).scenarios.map((s: any) => s.id);
    expect(ids.indexOf("docker-logs-none")).toBeLessThan(
      ids.indexOf("docker-logs"),
    );
  });

  it("keeps every comment in the file when a state precondition changes", () => {
    const result = edit(text, (m: any) => {
      const sc = m.scenarios.find((s: any) => s.id === "scout-no-image");
      sc.when.state = { "image.built": false, "source.patched": false };
    });
    const comments = (s: string) =>
      s.split("\n").filter((l) => /^\s*#/.test(l));
    expect(comments(result.text)).toEqual(comments(text));
  });

  it("adds a new scenario without disturbing the rest of the file", () => {
    const result = edit(text, (m: any) => {
      m.scenarios.push({
        id: "docker-version",
        when: { command: "docker version" },
        then: { output: ["Client: Docker Engine - Community"] },
      });
    });
    expect(result.strategy).toBe("splice");
    const diff = changedLines(text, result.text);
    expect(diff.every((d) => d.startsWith("+"))).toBe(true);
    expect((parse(result.text) as any).scenarios).toHaveLength(
      (parse(text) as any).scenarios.length + 1,
    );
  });

  it("edits the pace profiles without reformatting the scenarios below them", () => {
    const result = edit(text, (m: any) => {
      m.settings.pace.scan = 1600;
      m.settings.pace.deploy = 800;
    });
    const diff = changedLines(text, result.text);
    expect(diff.sort()).toEqual(
      [
        "- " + "    scan: 1400 # an analysis pass working",
        "+ " + "    scan: 1600 # an analysis pass working",
        "+ " + "    deploy: 800",
      ].sort(),
    );
  });
});

// A sweep over every scenario in both sample labs. Each edit is one an author
// would actually make in the editor, and each one has to keep the invariant
// (the file means the model) while staying on the surgical path.
describe("patchYaml sweeps the sample labs", () => {
  const labs = ["tour-of-docker", "platform-tour"];

  for (const lab of labs) {
    const path = join(
      import.meta.dirname,
      `../../public/labs/${lab}/simulator.yaml`,
    );
    const text = readFileSync(path, "utf8");
    const scenarioCount = (parse(text) as any).scenarios.length;

    for (const [name, mutate] of Object.entries({
      "renames the scenario": (sc: any) => {
        sc.id = `${sc.id}-renamed`;
      },
      "edits its description": (sc: any) => {
        sc.description = "An edited description, with a colon: and a #hash.";
      },
      "retitles its first output line": (sc: any) => {
        const out = sc.then.output ?? sc.then.stderr;
        if (!out?.length) return;
        const first = out[0];
        if (typeof first === "string") out[0] = `${first} (edited)`;
        else if (first.text) first.text = `${first.text} (edited)`;
      },
      "paces its first output line": (sc: any) => {
        const out = sc.then.output ?? sc.then.stderr;
        if (!out?.length || typeof out[0] !== "string") return;
        out[0] = { text: out[0], delay: "short" };
      },
      "appends an output line": (sc: any) => {
        sc.then.output = [...(sc.then.output ?? []), "an appended line"];
      },
      "sets an exit code": (sc: any) => {
        sc.then.exit = 3;
      },
      "adds a state precondition": (sc: any) => {
        sc.when.state = { ...(sc.when.state ?? {}), "editor.probe": true };
      },
      "adds a state effect": (sc: any) => {
        sc.then.state = { ...(sc.then.state ?? {}), "editor.touched": true };
      },
      "drops its effects to a bare output": (sc: any) => {
        for (const key of Object.keys(sc.then)) delete sc.then[key];
        sc.then.output = ["replaced"];
      },
    })) {
      it(`${lab}: ${name}`, () => {
        for (let i = 0; i < scenarioCount; i++) {
          const model = parse(text) as any;
          const before = JSON.stringify(model);
          mutate(model.scenarios[i]);
          if (JSON.stringify(model) === before) continue; // edit didn't apply here
          const result = patchYaml(text, model, {
            debug: (msg, detail) => {
              throw new Error(
                `scenario #${i} (${model.scenarios[i].id}) fell off the surgical path: ${msg}\n${detail ?? ""}`,
              );
            },
          });
          expect(parse(result.text)).toEqual(model);
          expect(result.strategy).toBe("splice");
        }
      });
    }
  }

  it("moves every scenario up one place, one at a time", () => {
    const path = join(
      import.meta.dirname,
      "../../public/labs/tour-of-docker/simulator.yaml",
    );
    const text = readFileSync(path, "utf8");
    const count = (parse(text) as any).scenarios.length;
    for (let i = 1; i < count; i++) {
      const model = parse(text) as any;
      const [sc] = model.scenarios.splice(i, 1);
      model.scenarios.splice(i - 1, 0, sc);
      const result = patchYaml(text, model);
      expect(parse(result.text)).toEqual(model);
      expect(result.strategy).toBe("splice");
      // A move rewrites no content, so the line multiset is unchanged.
      expect(changedLines(text, result.text)).toEqual([]);
    }
  });

  it("deletes every scenario, one at a time", () => {
    const path = join(
      import.meta.dirname,
      "../../public/labs/platform-tour/simulator.yaml",
    );
    const text = readFileSync(path, "utf8");
    const count = (parse(text) as any).scenarios.length;
    for (let i = 0; i < count; i++) {
      const model = parse(text) as any;
      model.scenarios.splice(i, 1);
      const result = patchYaml(text, model);
      expect(parse(result.text)).toEqual(model);
      expect(result.strategy).toBe("splice");
      expect(
        changedLines(text, result.text).every((l) => l.startsWith("-")),
      ).toBe(true);
    }
  });
});

describe("blank-line rhythm", () => {
  const text = [
    "scenarios:",
    "  - id: one",
    "    when: { command: [a] }",
    "",
    "  - id: two",
    "    when: { command: [b] }",
    "",
  ].join("\n");

  it("appends past the last item with a blank line before it, not after", () => {
    const result = edit(text, (m: any) => {
      m.scenarios.push({ id: "three", when: { command: "c" } });
    });
    expect(result.strategy).toBe("splice");
    expect(result.text).toBe(
      [
        "scenarios:",
        "  - id: one",
        "    when: { command: [a] }",
        "",
        "  - id: two",
        "    when: { command: [b] }",
        "",
        "  - id: three",
        "    when:",
        "      command: c",
        "",
      ].join("\n"),
    );
  });

  it("inserts before an existing item with a blank line after it", () => {
    const result = edit(text, (m: any) => {
      m.scenarios.splice(1, 0, { id: "middle", when: { command: "m" } });
    });
    expect(result.text).toBe(
      [
        "scenarios:",
        "  - id: one",
        "    when: { command: [a] }",
        "",
        "  - id: middle",
        "    when:",
        "      command: m",
        "",
        "  - id: two",
        "    when: { command: [b] }",
        "",
      ].join("\n"),
    );
  });

  it("moves an item to the end without doubling the blank line", () => {
    const result = edit(text, (m: any) => {
      m.scenarios.reverse();
    });
    expect(result.text).toBe(
      [
        "scenarios:",
        "  - id: two",
        "    when: { command: [b] }",
        "",
        "  - id: one",
        "    when: { command: [a] }",
        "",
      ].join("\n"),
    );
  });

  it("keeps a list with no blank lines tight", () => {
    const tight = 'output:\n  - "a"\n  - "b"\n';
    const result = edit(tight, (m: any) => {
      m.output.push("c");
    });
    expect(result.text).toBe('output:\n  - "a"\n  - "b"\n  - "c"\n');
  });
});
