import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseManifest } from "@dockersamples/simspace-simulator";
import { analyze } from "./analyze";
import { lint, type Finding, type LintContext } from "./lint";

function check(yaml: string, ctx: Partial<LintContext> = {}): Finding[] {
  const lab = parseManifest(yaml);
  return lint(lab, { analysis: analyze(lab), ...ctx });
}

function messages(findings: Finding[], severity?: string): string[] {
  return findings
    .filter((f) => !severity || f.severity === severity)
    .map((f) => f.message);
}

describe("lint", () => {
  it("passes a well-formed spec", () => {
    expect(
      check(`
version: "2.0"
state: { container: { running: false } }
scenarios:
  - id: run
    when: { command: [docker, run], args: { --name: { any: true } } }
    then:
      state: { container.running: true }
      output: ["Started {{ args.name }}"]
  - id: ps
    when: { command: [docker, ps], state: { container.running: true } }
    then: { output: ["up"] }
`),
    ).toEqual([]);
  });

  it("catches a missing or wrong schema version", () => {
    expect(messages(check(`scenarios: []\n`))).toContain(
      "simulator.yaml is missing a `version` field",
    );
    expect(messages(check(`version: "1.4"\nscenarios: []\n`))).toContain(
      'lab schema version "1.4" is incompatible with simulator schema "2.0"',
    );
  });

  it("catches duplicate ids", () => {
    const f = check(`
version: "2.0"
workflows:
  - { id: build, steps: [] }
  - { id: build, steps: [] }
controls:
  - { id: c, label: L, state: a.b }
  - { id: c, label: L, state: a.b }
scenarios:
  - { id: same, when: { command: [a] }, then: { output: ["x"] } }
  - { id: same, when: { command: [b] }, then: { output: ["y"] } }
`);
    expect(messages(f, "error")).toEqual(
      expect.arrayContaining([
        'duplicate workflow id "build"',
        'duplicate control id "c"',
        'duplicate scenario id "same"',
      ]),
    );
  });

  it("flags a template reference with no capture", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: run
    when: { command: [docker, run], args: { -d: true } }
    then: { output: ["Started {{ args.name }}"] }
`);
    expect(f[0]).toMatchObject({
      severity: "error",
      scenario: "run",
      path: "scenarios[0].then.output[0]",
      message:
        "then.output[0] references {{ args.name }} but no matching capture in when.args",
    });
  });

  it("accepts a flag capture referenced without its dashes", () => {
    expect(
      check(`
version: "2.0"
scenarios:
  - id: run
    when: { command: [docker, run], args: { --name: { any: true }, -t: { any: true } } }
    then: { output: ["{{ args.name }} {{ args.t }}"] }
`),
    ).toEqual([]);
  });

  it("flags an unknown pace profile and a negative delay", () => {
    const f = check(`
version: "2.0"
settings: { pace: { beat: 300 } }
scenarios:
  - id: run
    when: { command: [docker, run] }
    then:
      output:
        - { text: "a", delay: beet }
        - { text: "b", delay: -5 }
        - { text: "c", delay: beat }
`);
    expect(messages(f, "error")).toEqual([
      'then.output[0].delay "beet" is not a known pace profile (add it under settings.pace)',
      "then.output[1].delay is negative (-5)",
    ]);
  });

  it("warns about a pace profile nothing uses", () => {
    const f = check(`
version: "2.0"
settings: { pace: { unused: 300 } }
scenarios:
  - { id: a, when: { command: [x] }, then: { output: ["x"] } }
`);
    expect(messages(f, "warning")).toContain(
      'pace profile "unused" is declared but no output entry uses it',
    );
  });

  it("checks CI trigger references against the catalog", () => {
    const f = check(`
version: "2.0"
workflows:
  - id: build
    steps:
      - { id: compile, logs: ["…"] }
scenarios:
  - id: push-ok
    when: { command: [git, push] }
    then: { ci: { workflow: build, failedStep: compile } }
  - id: push-bad
    when: { command: [git, push, --force] }
    then: { ci: { workflow: deploy } }
  - id: push-bad-step
    when: { command: [git, push, --tags] }
    then: { ci: { workflow: build, failedStep: sign, steps: [{ id: nope, logs: [] }] } }
`);
    expect(messages(f, "error")).toEqual(
      expect.arrayContaining([
        'then.ci.workflow "deploy" is not in the workflows catalog',
        'then.ci.failedStep "sign" is not a step of "build"',
        'then.ci.steps id "nope" is not a step of "build"',
      ]),
    );
  });

  it("names the `+=` trap when then.state isn't a mapping", () => {
    // The spec's own §7.2 example has no colon, so YAML reads the whole block
    // as one string — the engine then iterates its characters.
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - id: log
    when: { command: [x] }
    then:
      state:
        events += "started"
`);
    const f = lint(lab, { analysis: analyze(lab) });
    expect(messages(f, "error")[0]).toContain("`state` must be a mapping");
  });

  it("checks file operations", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: files
    when: { command: [edit] }
    then:
      files:
        - { replace: server.js }
        - { copy: a.txt }
        - { content: "orphan" }
        - { create: a.txt, delete: b.txt }
`);
    expect(messages(f, "error")).toEqual([
      "then.files[0] is a `replace` with no `find`, which fails at run time",
      "then.files[1] is a `copy` with no `to`",
      "then.files[2] has no operation — one of mkdir/create/append/replace/delete/copy is required",
      "then.files[3] sets more than one operation (create, delete); each entry does exactly one thing",
    ]);
  });

  it("flags an unreachable scenario with the one that eats it", () => {
    const f = check(`
version: "2.0"
state: { container: { running: false } }
scenarios:
  - id: ps-any
    when: { command: [docker, ps] }
    then: { output: ["empty"] }
  - id: ps-running
    when: { command: [docker, ps], state: { container.running: true } }
    then: { output: ["up"] }
`);
    expect(
      f.find((x) => x.scenario === "ps-running" && x.severity === "error")
        ?.message,
    ).toBe(
      'unreachable: "ps-any" (#1) comes first and it checks less state, so it always matches first',
    );
  });

  it("warns about a state path nothing writes, and one nothing reads", () => {
    const f = check(`
version: "2.0"
state: { container: { running: false } }
scenarios:
  - id: typo
    when: { command: [docker, ps], state: { container.runnning: true } }
    then: { state: { container.stoppped: true }, output: ["x"] }
`);
    expect(messages(f, "warning")).toEqual(
      expect.arrayContaining([
        '"container.runnning" is read by "typo" but nothing seeds or writes it — check for a typo',
        '"container.stoppped" is written by "typo" but nothing reads it',
      ]),
    );
  });

  it("checks terminal ids and completes against the owning labspace", () => {
    const f = check(
      `
version: "2.0"
scenarios:
  - id: a
    completes: nonexistent-step
    when: { command: [x], terminal: nope }
    then: { output: ["x"] }
`,
      { terminalIds: ["host", "sandbox"], stepIds: ["run-container"] },
    );
    expect(messages(f, "error")).toEqual(
      expect.arrayContaining([
        'when.terminal "nope" is not a declared terminal id',
        'completes: "nonexistent-step" is not a step id cataloged by any section',
      ]),
    );
    expect(messages(f, "warning")).toContain(
      'step "run-container" is cataloged by a section but no scenario completes it',
    );
  });

  it("leaves terminal and step ids alone for a shared spec", () => {
    const f = check(
      `
version: "2.0"
scenarios:
  - id: a
    completes: a-step
    when: { command: [x], terminal: other }
    then: { output: ["x"] }
`,
      { terminalIds: ["demo"], stepIds: [], shared: true },
    );
    expect(messages(f, "error")).toEqual([]);
  });

  it("rejects a scenario that is both a command and an agent scenario", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: both
    when: { command: [docker], agent: true }
    then: { output: ["x"] }
`);
    expect(messages(f, "error")[0]).toContain("mutually exclusive");
  });

  it("warns about a scenario that matches everything", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: wildcard
    when: {}
    then: { output: ["x"] }
  - id: never
    when: { command: [docker] }
    then: { output: ["y"] }
`);
    expect(messages(f, "warning")[0]).toContain("matches EVERY command");
  });

  it("warns about a scenario with no effects at all", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: silent
    when: { command: [docker, ps] }
    then: {}
`);
    expect(messages(f, "warning")).toContain(
      "no effects — this scenario matches and then does nothing at all",
    );
  });

  it("leaves a deliberately silent command alone", () => {
    // `git add` really does print nothing; `output: []` says so on purpose.
    const f = check(`
version: "2.0"
scenarios:
  - id: git-add
    when: { command: [git, add] }
    then: { output: [] }
`);
    expect(messages(f, "warning")).toEqual([]);
  });

  it("counts a {{ state.x }} template as reading that path", () => {
    const f = check(`
version: "2.0"
state: { container: { name: web } }
scenarios:
  - id: run
    when: { command: [docker, run], args: { --name: { any: true } } }
    then: { state: { container.name: "{{ args.name }}" } }
  - id: ps
    when: { command: [docker, ps] }
    then: { output: ["a1b2c3   nginx   {{ state.container.name }}"] }
`);
    expect(messages(f, "warning")).toEqual([]);
  });

  it("checks an interactive input request", () => {
    const f = check(`
version: "2.0"
scenarios:
  - id: login
    when: { command: [sbx, login] }
    then:
      session: { prompt: "> " }
      input:
        steps:
          - { key: user, prompt: "User: " }
          - { key: user, prompt: "Again: " }
        then:
          output: ["hi {{ input.usr }}"]
`);
    expect(messages(f, "error")).toEqual(
      expect.arrayContaining([
        "`then.input` and `then.session` are mutually exclusive — a command either collects input or opens a session",
        'duplicate input step key "user"',
        'then.input.then.output[0] references {{ input.usr }} but no input step declares key "usr"',
      ]),
    );
  });

  it("warns about a control nothing reads", () => {
    const f = check(`
version: "2.0"
state: { net: { allowed: false } }
controls:
  - { id: net, label: "Allow the network", state: net.allowed }
scenarios:
  - { id: a, when: { command: [curl] }, then: { output: ["x"] } }
`);
    expect(messages(f, "warning")).toContain(
      'writes "net.allowed", which no scenario or workflow step reads',
    );
  });
});

describe("lint against the real labs", () => {
  for (const name of ["tour-of-docker", "platform-tour"]) {
    it(`${name} is clean apart from known-good warnings`, () => {
      const dir = join(import.meta.dirname, `../../public/labs/${name}`);
      const spec = readFileSync(join(dir, "simulator.yaml"), "utf8");
      const labspace = parse(
        readFileSync(join(dir, "labspace.yaml"), "utf8"),
      ) as any;
      const lab = parseManifest(spec);
      const findings = lint(lab, {
        analysis: analyze(lab),
        terminalIds: (labspace.terminals ?? []).map((t: any) => t.id),
        stepIds: (labspace.sections ?? []).flatMap((s: any) =>
          (s.steps ?? []).map((st: any) => st.id),
        ),
      });
      expect(messages(findings, "error")).toEqual([]);
    });
  }
});
