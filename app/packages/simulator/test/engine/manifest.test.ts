import { describe, expect, it } from "vitest";
import {
  ManifestError,
  checkSchemaVersion,
  parseManifest,
} from "../../src/engine/manifest";
import { SchemaVersion } from "../../src/engine/types";

const MINIMAL = `
version: "2.0"
scenarios: []
`;

describe("parseManifest structure", () => {
  it("parses a minimal manifest", () => {
    const lab = parseManifest(MINIMAL);
    expect(lab.version).toBe("2.0");
    expect(lab.scenarios).toEqual([]);
  });

  it("rejects unparseable YAML", () => {
    expect(() => parseManifest("a:\n  - b\n c: broken")).toThrow(ManifestError);
  });

  it("rejects an empty manifest", () => {
    expect(() => parseManifest("")).toThrow(/empty or not a mapping/);
  });

  it("rejects a top-level list, via the scenarios check", () => {
    // A YAML sequence is still `typeof "object"`, so it slips past the mapping
    // guard and is caught one step later by the `scenarios` check. Still a hard
    // rejection, just with a less on-the-nose message.
    expect(() => parseManifest("- a list")).toThrow(
      /`scenarios` must be a list/,
    );
  });

  it("requires scenarios to be a list", () => {
    expect(() => parseManifest(`version: "2.0"\nscenarios: {}`)).toThrow(
      /`scenarios` must be a list/,
    );
  });

  it("defaults a scenario id to its index", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when: { command: ls }
    then: { output: ["a"] }
`);
    expect(lab.scenarios[0].id).toBe("scenario-0");
  });
});

describe("checkSchemaVersion", () => {
  it("accepts a matching major", () => {
    expect(() => checkSchemaVersion(SchemaVersion)).not.toThrow();
    expect(() => checkSchemaVersion("2.7")).not.toThrow();
  });

  it("rejects a missing version", () => {
    expect(() => checkSchemaVersion("")).toThrow(/missing a `version` field/);
  });

  it("rejects a different major", () => {
    expect(() => checkSchemaVersion("1.0")).toThrow(/incompatible/);
    expect(() => checkSchemaVersion("3.0")).toThrow(/incompatible/);
  });
});

describe("command path normalization", () => {
  // Authors may write the path either way; both must reach the engine as the
  // same token list, since matching compares tokens.
  it("accepts a space-joined scalar", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when: { command: "policy allow network" }
    then: {}
`);
    expect(lab.scenarios[0].when.command).toEqual([
      "policy",
      "allow",
      "network",
    ]);
  });

  it("accepts a sequence", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when:
      command: [policy, allow, network]
    then: {}
`);
    expect(lab.scenarios[0].when.command).toEqual([
      "policy",
      "allow",
      "network",
    ]);
  });

  it("rejects a command that is neither a string nor a list", () => {
    expect(() =>
      parseManifest(`
version: "2.0"
scenarios:
  - when: { command: 42 }
    then: {}
`),
    ).toThrow(/`command` must be a string or list/);
  });
});

describe("arg matcher normalization", () => {
  function matchers(argsYaml: string) {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when:
      command: run
      args:
${argsYaml}
    then: {}
`);
    return lab.scenarios[0].when.args!;
  }

  it("maps a scalar to equals", () => {
    expect(matchers(`        name: web`).name).toEqual({
      kind: "equals",
      value: "web",
    });
  });

  it("stringifies a numeric scalar", () => {
    expect(matchers(`        count: 3`).count).toEqual({
      kind: "equals",
      value: "3",
    });
  });

  it("maps true to present and false to absent", () => {
    const m = matchers(`        publish: true\n        detach: false`);
    expect(m.publish).toEqual({ kind: "present" });
    expect(m.detach).toEqual({ kind: "absent" });
  });

  it("maps { any: true } to any", () => {
    expect(matchers(`        region: { any: true }`).region).toEqual({
      kind: "any",
    });
  });

  it("maps oneOf to a value list", () => {
    expect(matchers(`        env: { oneOf: [dev, prod] }`).env).toEqual({
      kind: "oneOf",
      oneOf: ["dev", "prod"],
    });
  });

  it("rejects a mapping matcher that sets neither any nor oneOf", () => {
    expect(() => matchers(`        bad: { nope: 1 }`)).toThrow(
      /must set `any: true` or a non-empty `oneOf`/,
    );
  });

  it("rejects an empty oneOf", () => {
    expect(() => matchers(`        bad: { oneOf: [] }`)).toThrow(
      /non-empty `oneOf`/,
    );
  });

  it("rejects a scalar args block", () => {
    expect(() =>
      parseManifest(`
version: "2.0"
scenarios:
  - when: { command: run, args: nope }
    then: {}
`),
    ).toThrow(/`args` must be a mapping/);
  });

  it("reads a YAML list of args as positional index matchers", () => {
    // A sequence passes the `typeof "object"` mapping guard, and its entries
    // land under keys "0", "1", … — which happens to be exactly how positional
    // matchers are addressed, so the loose form still means something sane.
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when: { command: run, args: [nginx, web] }
    then: {}
`);
    expect(lab.scenarios[0].when.args).toEqual({
      "0": { kind: "equals", value: "nginx" },
      "1": { kind: "equals", value: "web" },
    });
  });
});

describe("then.input normalization", () => {
  it("normalizes the single-step sugar into a steps list", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when: { command: login }
    then:
      input:
        key: token
        prompt: "Token: "
        mask: true
        then:
          output: ["ok"]
`);
    const input = lab.scenarios[0].then.input!;
    expect(input.steps).toEqual([
      { key: "token", prompt: "Token: ", mask: true },
    ]);
    expect(input.then.output).toEqual(["ok"]);
  });

  it("accepts an explicit steps list and defaults mask to false", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios:
  - when: { command: login }
    then:
      input:
        steps:
          - { key: user, prompt: "User: " }
          - { key: pass, prompt: "Pass: ", mask: true }
        then: { output: ["ok"] }
`);
    expect(lab.scenarios[0].then.input!.steps).toEqual([
      { key: "user", prompt: "User: ", mask: false },
      { key: "pass", prompt: "Pass: ", mask: true },
    ]);
  });

  it("requires a key and a prompt on every step", () => {
    const withStep = (step: string) => () =>
      parseManifest(`
version: "2.0"
scenarios:
  - id: login
    when: { command: login }
    then:
      input:
        steps: [${step}]
        then: {}
`);
    expect(withStep(`{ prompt: "P" }`)).toThrow(/is missing `key`/);
    expect(withStep(`{ key: k }`)).toThrow(/is missing `prompt`/);
  });

  it("rejects an input request with no steps", () => {
    expect(() =>
      parseManifest(`
version: "2.0"
scenarios:
  - id: login
    when: { command: login }
    then:
      input:
        steps: []
        then: {}
`),
    ).toThrow(/declares no steps/);
  });
});

describe("controls and workflows", () => {
  it("parses controls with defaulted enabled/disabled values", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios: []
controls:
  - id: secrets
    label: "Secret scanning"
    state: config.secrets
`);
    expect(lab.controls).toEqual([
      {
        id: "secrets",
        label: "Secret scanning",
        description: undefined,
        state: "config.secrets",
        enabled: true,
        disabled: false,
      },
    ]);
  });

  it("requires a control label and state path", () => {
    const control = (body: string) => () =>
      parseManifest(`version: "2.0"\nscenarios: []\ncontrols:\n  - ${body}`);
    expect(control(`{ id: a, state: x }`)).toThrow(/`label` is required/);
    expect(control(`{ id: a, label: L }`)).toThrow(/`state` is required/);
  });

  it("parses workflows, defaulting the name to the id", () => {
    const lab = parseManifest(`
version: "2.0"
scenarios: []
workflows:
  - id: build
    steps:
      - { id: compile, name: Compile }
`);
    expect(lab.workflows![0].name).toBe("build");
    expect(lab.workflows![0].steps[0]).toMatchObject({
      id: "compile",
      name: "Compile",
    });
  });

  it("requires a workflow id", () => {
    expect(() =>
      parseManifest(`version: "2.0"\nscenarios: []\nworkflows:\n  - name: X`),
    ).toThrow(/`id` is required/);
  });
});
