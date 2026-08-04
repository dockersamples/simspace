import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/engine/simulator";
import { ManifestError } from "../../src/engine/manifest";

/** Text of the lines a command produced, by stream. */
function texts(lines: { text: string; stream: string }[], stream = "stdout") {
  return lines.filter((l) => l.stream === stream).map((l) => l.text);
}

const SPEC = `
version: "2.0"
metadata:
  title: "Test lab"
  summary: "Fixture"
state:
  running: false
scenarios:
  - id: run
    when: { command: "docker run", args: { name: { any: true } } }
    completes: start-container
    then:
      state:
        running: true
        lastName: "{{ args.name }}"
      output:
        - "started {{ args.name }}"

  - id: ps-running
    when: { command: "docker ps", state: { running: true } }
    then:
      output: ["CONTAINER  {{ state.lastName }}"]

  - id: ps-empty
    when: { command: "docker ps" }
    then:
      output: ["no containers"]

  - id: write
    # The args matcher is what CAPTURES name; without it {{ args.name }} below
    # would render empty even though the flag was typed.
    when: { command: "make config", args: { name: { any: true } } }
    then:
      files:
        - create: "config/app.yaml"
          content: "name: {{ args.name }}\\nport: 8080"
      output: ["wrote config/app.yaml"]

  - id: broken
    when: { command: "break it" }
    then:
      files:
        - replace: "config/app.yaml"
          find: "nothing-here"
          with: "x"

  - id: fail
    when: { command: "docker deploy" }
    then:
      stderr: ["permission denied"]
      exit: 13

  - id: audit
    when: { command: "audit add", args: { 0: { any: true } } }
    then:
      state:
        "events+=": "{{ args.0 }}"
      output: ["recorded"]
`;

const sim = () => new Simulator({ spec: SPEC });

describe("construction", () => {
  it("rejects a spec with no version", () => {
    expect(() => new Simulator({ spec: `scenarios: []` })).toThrow(
      ManifestError,
    );
  });

  it("rejects an incompatible major version", () => {
    expect(
      () => new Simulator({ spec: `version: "1.0"\nscenarios: []` }),
    ).toThrow(/incompatible/);
  });

  it("seeds state from the manifest", () => {
    expect(sim().getState("running")).toBe(false);
  });

  it("exposes parsed metadata for the terminal greeting", () => {
    expect(sim().lab.metadata?.title).toBe("Test lab");
  });

  it("returns null for an unset state path", () => {
    expect(sim().getState("nope.at.all")).toBeNull();
  });
});

describe("execute", () => {
  it("renders output with captured args and reports the matched scenario", () => {
    const s = sim();
    const outcome = s.execute("docker run --name web");
    expect(texts(outcome.lines)).toEqual(["started web"]);
    expect(outcome.matched).toBe("run");
    expect(outcome.exit).toBe(0);
  });

  it("surfaces the completed step id so the app layer can record progress", () => {
    // The engine only REPORTS completion — recording and telemetry live outside,
    // which is what keeps it pure.
    expect(sim().execute("docker run --name web").completes).toBe(
      "start-container",
    );
    expect(sim().execute("docker ps").completes).toBeUndefined();
  });

  it("applies state deltas, changing which scenario matches next", () => {
    const s = sim();
    expect(texts(s.execute("docker ps").lines)).toEqual(["no containers"]);
    s.execute("docker run --name web");
    expect(s.getState("running")).toBe(true);
    expect(texts(s.execute("docker ps").lines)).toEqual(["CONTAINER  web"]);
  });

  it("appends to a list with the += suffix", () => {
    const s = sim();
    s.execute("audit add first");
    s.execute("audit add second");
    expect(s.getState("events")).toEqual(["first", "second"]);
  });

  it("writes templated file content", () => {
    const s = sim();
    s.execute("make config --name web");
    expect(s.files()["config/app.yaml"]).toBe("name: web\nport: 8080");
  });

  it("carries a scenario's exit code and stderr", () => {
    const outcome = sim().execute("docker deploy");
    expect(texts(outcome.lines, "stderr")).toEqual(["permission denied"]);
    expect(outcome.exit).toBe(13);
  });

  it("ignores a blank command line", () => {
    const outcome = sim().execute("   ");
    expect(outcome.lines).toEqual([]);
    expect(outcome.matched).toBe("");
  });

  it("records commands in history", () => {
    const s = sim();
    s.execute("docker ps");
    s.execute("docker run --name web");
    expect(s.getState("history")).toEqual([
      "docker ps",
      "docker run --name web",
    ]);
  });

  it("reports a failed file effect as an error line instead of throwing", () => {
    // An authoring mistake must not take down the page hosting the terminal.
    const s = sim();
    s.execute("make config --name web");
    const outcome = s.execute("break it");
    expect(outcome.exit).toBe(1);
    expect(texts(outcome.lines, "stderr")[0]).toMatch(/text not found/);
  });
});

describe("unmatched commands", () => {
  it("reports the built-in not-found default", () => {
    const outcome = sim().execute("kubectl get pods");
    expect(texts(outcome.lines, "stderr")).toEqual([
      "command not found — this command is not simulated in this lab.",
    ]);
    expect(outcome.exit).toBe(127);
    expect(outcome.matched).toBe("");
  });

  it("uses the lab's own unmatched default when declared", () => {
    const s = new Simulator({
      spec: `
version: "2.0"
scenarios: []
defaults:
  unmatched:
    stderr: ["try 'help'"]
    exit: 2
`,
    });
    const outcome = s.execute("whatever");
    expect(texts(outcome.lines, "stderr")).toEqual(["try 'help'"]);
    expect(outcome.exit).toBe(2);
  });
});

describe("built-in ls and cat", () => {
  const withFiles = () =>
    new Simulator({
      spec: `version: "2.0"\nscenarios: []`,
      files: { "README.md": "hello\n", "app/server.js": "one\ntwo\n" },
    });

  it("lists the root, marking directories with a slash", () => {
    const outcome = withFiles().execute("ls");
    expect(texts(outcome.lines)).toEqual(["app/", "README.md"]);
    expect(outcome.matched).toBe("__builtin__");
  });

  it("lists a directory's contents", () => {
    expect(texts(withFiles().execute("ls app").lines)).toEqual(["server.js"]);
  });

  it("prints a file's lines without a trailing blank", () => {
    expect(texts(withFiles().execute("cat app/server.js").lines)).toEqual([
      "one",
      "two",
    ]);
  });

  it("errors on a missing path", () => {
    const outcome = withFiles().execute("cat nope.txt");
    expect(texts(outcome.lines, "stderr")).toEqual([
      "cat: nope.txt: No such file or directory",
    ]);
    expect(outcome.exit).toBe(1);
  });

  it("lets a scenario override a built-in", () => {
    // Built-ins fire only when nothing matched, so an author can always
    // reclaim `ls` for teaching.
    const s = new Simulator({
      spec: `
version: "2.0"
scenarios:
  - id: fake-ls
    when: { command: ls }
    then: { output: ["scripted"] }
`,
      files: { "real.txt": "x" },
    });
    expect(texts(s.execute("ls").lines)).toEqual(["scripted"]);
  });

  it("reflects files written after start", () => {
    const s = withFiles();
    s.writeFile("notes.md", "later");
    expect(texts(s.execute("cat notes.md").lines)).toEqual(["later"]);
  });
});

describe("determinism", () => {
  it("produces identical output and state for the same command sequence", () => {
    // The property the whole design rests on: no clock, no randomness, no
    // network — so a lab, a docs page, and a test all see the same thing.
    const script = [
      "docker ps",
      "docker run --name web",
      "docker ps",
      "make config --name web",
      "audit add one",
      "kubectl get pods",
    ];
    const runOnce = () => {
      const s = sim();
      const output = script.map((line) => s.execute(line));
      return {
        output: JSON.stringify(output),
        state: JSON.stringify(s.state()),
        files: JSON.stringify(s.files()),
      };
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it("applies state deltas in a stable order regardless of YAML key order", () => {
    const build = (keys: string) =>
      new Simulator({
        spec: `version: "2.0"\nscenarios:\n  - id: s\n    when: { command: go }\n    then:\n      state:\n${keys}`,
      });
    const a = build(`        b: 2\n        a: 1\n`);
    const b = build(`        a: 1\n        b: 2\n`);
    a.execute("go");
    b.execute("go");
    expect(a.state()).toEqual(b.state());
  });
});

describe("reset and restore", () => {
  it("re-seeds state and the filesystem", () => {
    const s = new Simulator({
      spec: SPEC,
      files: { "seed.txt": "original" },
    });
    s.execute("docker run --name web");
    s.writeFile("seed.txt", "changed");
    s.writeFile("extra.txt", "new");

    s.reset();

    expect(s.getState("running")).toBe(false);
    expect(s.getState("history")).toBeNull();
    expect(s.files()).toEqual({ "seed.txt": "original" });
  });

  it("restores a persisted snapshot instead of seeding", () => {
    const first = new Simulator({ spec: SPEC });
    first.execute("docker run --name web");

    const resumed = new Simulator({
      spec: SPEC,
      restoredState: first.state(),
      restoredFiles: first.files(),
    });
    // A resumed session must see the world it left, not a fresh seed.
    expect(resumed.getState("running")).toBe(true);
    expect(texts(resumed.execute("docker ps").lines)).toEqual([
      "CONTAINER  web",
    ]);
  });

  it("re-seeds from the manifest on reset even when it started restored", () => {
    const s = new Simulator({
      spec: SPEC,
      restoredState: { running: true, lastName: "web" },
    });
    s.reset();
    expect(s.getState("running")).toBe(false);
  });
});

describe("controls", () => {
  it("writes a control's state path", () => {
    const s = new Simulator({
      spec: `
version: "2.0"
scenarios:
  - id: push
    when: { command: push, state: { "config.secrets": true } }
    then: { output: ["scanning"] }
controls:
  - id: secrets
    label: "Secret scanning"
    state: config.secrets
`,
    });
    expect(texts(s.execute("push").lines)).toEqual([]);
    s.setControl("config.secrets", true);
    expect(texts(s.execute("push").lines)).toEqual(["scanning"]);
  });
});
