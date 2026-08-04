import { describe, expect, it } from "vitest";
import { parseCommand, tokenize } from "../../src/engine/commands";
import { parseManifest } from "../../src/engine/manifest";
import { match, matchAgent } from "../../src/engine/match";
import { Store } from "../../src/engine/state";
import type { Lab, StateValue } from "../../src/engine/types";

function lab(scenariosYaml: string): Lab {
  return parseManifest(`version: "2.0"\nscenarios:\n${scenariosYaml}`);
}

function hit(
  l: Lab,
  line: string,
  state: Record<string, StateValue> = {},
  terminalId?: string,
) {
  return match(l, parseCommand(tokenize(line)), Store.seed(state), terminalId);
}

describe("scenario ordering", () => {
  const l = lab(`
  - id: specific
    when: { command: "docker run", args: { name: web } }
    then: {}
  - id: general
    when: { command: "docker run" }
    then: {}
`);

  it("takes the first full match, not the best one", () => {
    // First-match-wins is the whole contract authors rely on: they order
    // specific before general. A "most specific wins" engine would silently
    // reorder their intent.
    expect(hit(l, "docker run --name web")!.scenario.id).toBe("specific");
  });

  it("falls through to a later scenario when an earlier one does not match", () => {
    expect(hit(l, "docker run --name other")!.scenario.id).toBe("general");
  });

  it("returns null when nothing matches", () => {
    expect(hit(l, "kubectl get pods")).toBeNull();
  });
});

describe("command path matching", () => {
  const l = lab(`
  - id: run
    when: { command: "docker run" }
    then: {}
`);

  it("matches the path as a prefix, ignoring extra positionals", () => {
    expect(hit(l, "docker run nginx")).not.toBeNull();
  });

  it("does not match a shorter command line", () => {
    expect(hit(l, "docker")).toBeNull();
  });

  it("does not match a different path", () => {
    expect(hit(l, "docker ps")).toBeNull();
  });

  it("matches any command when the scenario declares no path", () => {
    const catchAll = lab(`  - id: any\n    when: {}\n    then: {}`);
    expect(hit(catchAll, "literally anything")!.scenario.id).toBe("any");
  });
});

describe("arg matchers", () => {
  it("equals matches an exact flag value and captures it", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { name: web } }
    then: {}
`);
    expect(hit(l, "run --name web")!.args).toEqual({ name: "web" });
    expect(hit(l, "run --name other")).toBeNull();
    expect(hit(l, "run")).toBeNull();
  });

  it("present matches any value without capturing", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { detach: true } }
    then: {}
`);
    expect(hit(l, "run --detach")!.args).toEqual({});
    expect(hit(l, "run")).toBeNull();
  });

  it("absent matches only when the flag is missing", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { detach: false } }
    then: {}
`);
    expect(hit(l, "run")).not.toBeNull();
    expect(hit(l, "run --detach")).toBeNull();
  });

  it("any matches a present flag and captures its value", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { name: { any: true } } }
    then: {}
`);
    expect(hit(l, "run --name anything")!.args).toEqual({ name: "anything" });
    expect(hit(l, "run")).toBeNull();
  });

  it("oneOf matches a listed value and captures it", () => {
    const l = lab(`
  - id: s
    when: { command: deploy, args: { env: { oneOf: [dev, prod] } } }
    then: {}
`);
    expect(hit(l, "deploy --env prod")!.args).toEqual({ env: "prod" });
    expect(hit(l, "deploy --env staging")).toBeNull();
  });

  it("matches a flag name written with dashes in the spec", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { "--name": web } }
    then: {}
`);
    // Captures are keyed dash-stripped, because the template grammar
    // ({{ args.name }}) has no way to express a dash.
    expect(hit(l, "run --name web")!.args).toEqual({ name: "web" });
  });

  it("indexes positional args by number", () => {
    const l = lab(`
  - id: s
    when: { command: "docker run", args: { 0: nginx } }
    then: {}
`);
    expect(hit(l, "docker run nginx")!.args).toEqual({ "0": "nginx" });
    expect(hit(l, "docker run redis")).toBeNull();
  });

  it("ANDs every declared matcher", () => {
    const l = lab(`
  - id: s
    when: { command: run, args: { name: web, detach: true } }
    then: {}
`);
    expect(hit(l, "run --name web --detach")).not.toBeNull();
    expect(hit(l, "run --name web")).toBeNull();
  });
});

describe("exact prompt matching", () => {
  it("compares the remaining positionals joined", () => {
    const l = lab(`
  - id: s
    when: { command: say, prompt: "hello world" }
    then: {}
`);
    expect(hit(l, "say hello world")).not.toBeNull();
    expect(hit(l, "say hello")).toBeNull();
  });
});

describe("state preconditions", () => {
  const l = lab(`
  - id: s
    when: { command: stop, state: { running: true } }
    then: {}
`);

  it("matches when the state value is equal", () => {
    expect(hit(l, "stop", { running: true })).not.toBeNull();
  });

  it("does not match when the state value differs", () => {
    expect(hit(l, "stop", { running: false })).toBeNull();
  });

  it("does not match when the key is absent and the expectation is truthy", () => {
    expect(hit(l, "stop", {})).toBeNull();
  });

  it("treats an absent key as its zero value", () => {
    // This is why an author can write `running: false` without seeding the key:
    // unset and explicitly-false are the same precondition.
    const zero = lab(`
  - id: s
    when: { command: start, state: { running: false } }
    then: {}
`);
    expect(hit(zero, "start", {})).not.toBeNull();
    expect(hit(zero, "start", { running: false })).not.toBeNull();
    expect(hit(zero, "start", { running: true })).toBeNull();
  });

  it("matches nested dot-paths", () => {
    const nested = lab(`
  - id: s
    when: { command: push, state: { "config.secrets": true } }
    then: {}
`);
    expect(hit(nested, "push", { config: { secrets: true } })).not.toBeNull();
    expect(hit(nested, "push", { config: { secrets: false } })).toBeNull();
  });

  it("compares composite values structurally", () => {
    const list = lab(`
  - id: s
    when: { command: check, state: { tags: [a, b] } }
    then: {}
`);
    expect(hit(list, "check", { tags: ["a", "b"] })).not.toBeNull();
    expect(hit(list, "check", { tags: ["b", "a"] })).toBeNull();
  });
});

describe("terminal scoping", () => {
  const l = lab(`
  - id: host-only
    when: { command: whoami, terminal: host }
    then: {}
  - id: anywhere
    when: { command: whoami }
    then: {}
`);

  it("matches a scoped scenario only in its own terminal", () => {
    expect(hit(l, "whoami", {}, "host")!.scenario.id).toBe("host-only");
    expect(hit(l, "whoami", {}, "agent")!.scenario.id).toBe("anywhere");
  });

  it("skips a scoped scenario when no terminal id is supplied", () => {
    expect(hit(l, "whoami")!.scenario.id).toBe("anywhere");
  });
});

describe("agent matching", () => {
  const l = lab(`
  - id: exact
    when: { agent: true, prompt: "fix the bug" }
    then: {}
  - id: keywords
    when: { agent: true, promptContains: [health, endpoint] }
    then: {}
  - id: fallback
    when: { agent: true }
    then: {}
`);
  const agent = (prompt: string, terminalId?: string) =>
    matchAgent(l, prompt, Store.seed({}), terminalId);

  it("matches an exact prompt, ignoring surrounding whitespace", () => {
    expect(agent("fix the bug")!.scenario.id).toBe("exact");
    expect(agent("  fix the bug  ")!.scenario.id).toBe("exact");
  });

  it("requires every promptContains keyword, case-insensitively", () => {
    expect(agent("Add a HEALTH ENDPOINT please")!.scenario.id).toBe("keywords");
    expect(agent("add a health check")!.scenario.id).toBe("fallback");
  });

  it("falls back to a catch-all agent scenario", () => {
    expect(agent("something else entirely")!.scenario.id).toBe("fallback");
  });

  it("never matches command scenarios, and command matching never matches agent ones", () => {
    const mixed = lab(`
  - id: cmd
    when: { command: ls }
    then: {}
  - id: ag
    when: { agent: true }
    then: {}
`);
    expect(matchAgent(mixed, "ls", Store.seed({}))!.scenario.id).toBe("ag");
    expect(hit(mixed, "ls")!.scenario.id).toBe("cmd");
  });
});
