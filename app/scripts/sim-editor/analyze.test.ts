import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "@dockersamples/simspace-simulator";
import {
  analyze,
  exampleCommand,
  scenarioComments,
  statePairs,
  summarize,
  triggerLabel,
} from "./analyze";

function lab(yaml: string) {
  return parseManifest(yaml);
}

describe("summaries", () => {
  it("describes a command scenario the way a list row needs it", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: docker-run
    description: Start a container
    completes: run-container
    when:
      command: [docker, run]
      args: { --name: { any: true }, -d: true, --rm: false }
      state: { container.running: false }
      terminal: host
    then:
      state: { container.running: true, container.events +=: "started" }
      output:
        - "Unable to find image"
        - { text: "Pulling", delay: pull }
        - { delay: long }
      exit: 0
`);
    const s = summarize(l.scenarios[0], 0);
    expect(s).toMatchObject({
      index: 0,
      id: "docker-run",
      kind: "command",
      terminal: "host",
      completes: "run-container",
      outputLines: 3,
      pacedLines: 2,
    });
    expect(s.trigger).toBe("docker run --name=* -d !--rm");
    expect(s.requires).toEqual([{ path: "container.running", value: false }]);
    expect(s.sets).toEqual([
      { path: "container.running", value: true },
      { path: "container.events", value: "started", append: true },
    ]);
    expect(s.effects).toEqual(["output", "state"]);
  });

  it("labels an agent scenario by its prompt trigger", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: exact
    when: { agent: true, prompt: "add a /health endpoint" }
    then: { output: ["ok"] }
  - id: keywords
    when: { agent: true, promptContains: [health, endpoint] }
    then: { output: ["ok"] }
  - id: catch-all
    when: { agent: true }
    then: { output: ["ok"] }
`);
    expect(l.scenarios.map((s) => triggerLabel(s.when))).toEqual([
      'prompt = "add a /health endpoint"',
      "prompt ~ health + endpoint",
      "any prompt",
    ]);
    expect(summarize(l.scenarios[0], 0).kind).toBe("agent");
    expect(summarize(l.scenarios[0], 0).example).toBeUndefined();
  });

  it("builds an example command line from the matchers", () => {
    const cases: [string, string][] = [
      ["command: [docker, ps]", "docker ps"],
      [
        "command: [docker, run]\n      args: { --name: web, -d: true }",
        "docker run --name web -d",
      ],
      [
        "command: [curl]\n      args: { 0: { oneOf: [localhost:8080, other] } }",
        "curl localhost:8080",
      ],
      [
        "command: [docker, pull]\n      args: { 0: { any: true } }",
        "docker pull VALUE",
      ],
      [
        "command: [npm, install]\n      prompt: express@4.19.2",
        "npm install express@4.19.2",
      ],
      ["command: [docker, rm]\n      args: { -f: false }", "docker rm"],
    ];
    for (const [when, expected] of cases) {
      const l = lab(
        `version: "2.0"\nscenarios:\n  - id: x\n    when:\n      ${when}\n    then: { output: [] }\n`,
      );
      expect(exampleCommand(l.scenarios[0].when)).toBe(expected);
    }
  });

  it("separates an append effect from its path", () => {
    expect(statePairs({ "log += ": "a", "b.c": 1 })).toEqual([
      { path: "log", value: "a", append: true },
      { path: "b.c", value: 1 },
    ]);
  });
});

describe("overlaps", () => {
  it("flags a specific scenario made unreachable by an earlier general one", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: ps-any
    when: { command: [docker, ps] }
    then: { output: ["empty"] }
  - id: ps-running
    when:
      command: [docker, ps]
      state: { container.running: true }
    then: { output: ["a1b2c3"] }
`);
    const a = analyze(l);
    expect(a.overlaps["ps-running"]).toEqual([
      {
        id: "ps-any",
        index: 0,
        relation: "shadowed-by",
        reason: "it checks less state, so it always matches first",
      },
    ]);
    expect(a.overlaps["ps-any"][0]).toMatchObject({
      id: "ps-running",
      relation: "shadows",
    });
  });

  it("does not flag the correct order — specific first, fallback second", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: ps-running
    when:
      command: [docker, ps]
      state: { container.running: true }
    then: { output: ["a1b2c3"] }
  - id: ps-empty
    when: { command: [docker, ps] }
    then: { output: ["empty"] }
`);
    const a = analyze(l);
    expect(a.overlaps["ps-empty"]).toEqual([
      {
        id: "ps-running",
        index: 0,
        relation: "same-trigger",
        reason: "matches the same command",
      },
    ]);
  });

  it("treats a shorter command prefix as shadowing a longer one", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: docker-anything
    when: { command: [docker] }
    then: { output: ["?"] }
  - id: docker-compose-up
    when: { command: [docker, compose, up] }
    then: { output: ["up"] }
`);
    expect(analyze(l).overlaps["docker-compose-up"][0]).toMatchObject({
      relation: "shadowed-by",
      reason: "its command prefix is shorter, so it always matches first",
    });
  });

  it("keeps terminal-scoped scenarios out of each other's way", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: sbx-run-sandbox
    when: { command: [sbx, run], terminal: sandbox }
    then: { output: ["starting"] }
  - id: sbx-run-host
    when: { command: [sbx, run], terminal: host }
    then: { stderr: ["wrong tab"] }
`);
    const a = analyze(l);
    expect(a.overlaps["sbx-run-host"][0].relation).toBe("same-trigger");
  });

  it("never claims a command scenario shadows an agent one", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: cmd
    when: { command: [health] }
    then: { output: ["x"] }
  - id: agent
    when: { agent: true, promptContains: [health] }
    then: { output: ["y"] }
`);
    expect(analyze(l).overlaps["agent"]).toEqual([]);
  });

  it("flags an agent catch-all placed before a keyword scenario", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: catch-all
    when: { agent: true }
    then: { output: ["hmm"] }
  - id: health
    when: { agent: true, promptContains: [health] }
    then: { output: ["adding"] }
`);
    expect(analyze(l).overlaps["health"][0]).toMatchObject({
      id: "catch-all",
      relation: "shadowed-by",
    });
  });
});

describe("state map", () => {
  const l = lab(`
version: "2.0"
state:
  container:
    running: false
    name: web
  hub:
    configured: false
controls:
  - id: hub-credentials
    label: "Configure Docker Hub credentials"
    state: hub.configured
workflows:
  - id: build
    steps:
      - id: login
        requires: hub.configured
scenarios:
  - id: run
    when: { command: [docker, run], state: { container.running: false } }
    then: { state: { container.running: true } }
  - id: ps
    when: { command: [docker, ps], state: { container.running: true } }
    then: { output: ["{{ state.container.name }}"] }
`);

  it("gathers every touchpoint of a state path", () => {
    const a = analyze(l);
    const running = a.state.find((f) => f.path === "container.running")!;
    expect(running).toEqual({
      path: "container.running",
      seeded: true,
      seed: false,
      readers: ["run", "ps"],
      writers: ["run"],
      controls: [],
      requiredBy: [],
    });

    const hub = a.state.find((f) => f.path === "hub.configured")!;
    expect(hub).toMatchObject({
      seeded: true,
      controls: ["hub-credentials"],
      requiredBy: ["build/login"],
      readers: [],
      writers: [],
    });
  });

  it("lists a path nothing seeds, so a typo is visible", () => {
    const typo = lab(`
version: "2.0"
state: { container: { running: false } }
scenarios:
  - id: ps
    when: { command: [docker, ps], state: { container.runnning: true } }
    then: { output: [] }
`);
    const fact = analyze(typo).state.find(
      (f) => f.path === "container.runnning",
    )!;
    expect(fact.seeded).toBe(false);
    expect(fact.readers).toEqual(["ps"]);
  });

  it("includes the pace profiles a delay can name", () => {
    const paced = lab(
      `version: "2.0"\nsettings: { pace: { beat: 300 } }\nscenarios: []\n`,
    );
    expect(analyze(paced).paceNames.sort()).toEqual([
      "beat",
      "long",
      "medium",
      "short",
    ]);
  });
});

describe("transitions", () => {
  it("links the scenario that sets state to the ones that need it", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: run
    when: { command: [docker, run] }
    then: { state: { container.running: true } }
  - id: ps
    when: { command: [docker, ps], state: { container.running: true } }
    then: { output: ["up"] }
  - id: stop
    when: { command: [docker, stop], state: { container.running: true } }
    then: { state: { container.running: false } }
`);
    const t = analyze(l).transitions;
    expect(t["ps"].from).toEqual(["run"]);
    expect(t["run"].to).toEqual(["ps", "stop"]);
    expect(t["stop"].to).toEqual([]);
  });

  it("treats a templated write as able to satisfy a string precondition", () => {
    const l = lab(`
version: "2.0"
scenarios:
  - id: name-it
    when: { command: [docker, run], args: { --name: { any: true } } }
    then: { state: { container.name: "{{ args.name }}" } }
  - id: uses-name
    when: { command: [docker, inspect], state: { container.name: web } }
    then: { output: ["…"] }
`);
    expect(analyze(l).transitions["uses-name"].from).toEqual(["name-it"]);
  });
});

describe("scenarioComments", () => {
  it("separates a scenario's own note from the section banner above it", () => {
    const text = [
      "scenarios:",
      "  # ══ SECTION 1 ══",
      "",
      "  - id: first",
      "    when: { command: [a] }",
      "",
      "  # A rebuild AFTER the fix produces a patched image.",
      "  # Must precede docker-build.",
      "  - id: second",
      "    when: { command: [b] }",
      "",
      "  # ══ SECTION 2 ══",
      "",
      "  # and a note too",
      "  - id: third",
      "    when: { command: [c] }",
      "",
    ].join("\n");

    expect(scenarioComments(text.split("\n"))).toEqual([
      { banner: "══ SECTION 1 ══" },
      {
        note: "A rebuild AFTER the fix produces a patched image.\nMust precede docker-build.",
      },
      { banner: "══ SECTION 2 ══", note: "and a note too" },
    ]);
  });

  it("ignores nested sequence items", () => {
    const text = [
      "scenarios:",
      "  - id: one",
      "    then:",
      "      output:",
      "        # not a scenario comment",
      '        - "a line"',
      "  - id: two",
      "    then: { output: [] }",
      "",
    ].join("\n");
    expect(scenarioComments(text.split("\n"))).toEqual([{}, {}]);
  });
});

describe("analysis of the real labs", () => {
  for (const name of ["tour-of-docker", "platform-tour"]) {
    it(`${name} has no unreachable scenarios`, () => {
      const text = readFileSync(
        join(import.meta.dirname, `../../public/labs/${name}/simulator.yaml`),
        "utf8",
      );
      const a = analyze(parseManifest(text));
      const shadowed = Object.entries(a.overlaps)
        .filter(([, list]) => list.some((o) => o.relation === "shadowed-by"))
        .map(([id]) => id);
      expect(shadowed).toEqual([]);
      expect(a.scenarios.length).toBeGreaterThan(5);
      expect(a.state.length).toBeGreaterThan(5);
    });
  }
});
