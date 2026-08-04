import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/index";

// The engine's purity is a product claim, not a style preference: it is what
// lets the same state machine run in a lab, a docs page, a slide, a validator,
// and a test, and what makes "same commands ⇒ same output" true. Those
// properties are easy to break silently — one `Date.now()` for a timestamp, one
// `localStorage` for convenience — so they're asserted here rather than trusted.

const ENGINE_DIR = join(import.meta.dirname, "../../src/engine");

function engineFiles(): { name: string; code: string }[] {
  return readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((name) => ({
      name,
      // Strip comments first: prose legitimately MENTIONS localStorage and the
      // clock when explaining why the engine doesn't use them.
      code: stripComments(readFileSync(join(ENGINE_DIR, name), "utf8")),
    }));
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("engine source purity", () => {
  const files = engineFiles();

  it("finds the engine sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each([
    ["the DOM", /\b(document|window|navigator)\s*\./],
    ["browser storage", /\b(localStorage|sessionStorage|indexedDB)\b/],
    ["the network", /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/],
    ["Node APIs", /\b(process|require)\s*[.(]/],
    ["the clock", /\b(Date\s*\.\s*now|new\s+Date)\b/],
    ["randomness", /\bMath\s*\.\s*random\b/],
    ["timers", /\b(setTimeout|setInterval)\s*\(/],
  ])("never touches %s", (_what, pattern) => {
    const offenders = files
      .filter((f) => pattern.test(f.code))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("imports nothing beyond its own modules and the YAML parser", () => {
    const external = new Set<string>();
    for (const { code } of files) {
      for (const m of code.matchAll(/from\s+"([^"]+)"/g)) {
        if (!m[1].startsWith(".")) external.add(m[1]);
      }
    }
    // Every dependency here has to be installable by every consumer, so the set
    // staying this small is the point.
    expect([...external]).toEqual(["yaml"]);
  });

  it("never reaches into the React layer", () => {
    // Layering runs one way: react/ imports engine/, never the reverse. That's
    // what keeps the engine-only entry point free of React for validators and
    // tooling.
    for (const { name, code } of files) {
      expect(code, `${name} imports the React layer`).not.toMatch(
        /from\s+"\.\.\/react/,
      );
    }
  });
});

describe("engine runtime purity", () => {
  // These run in the `node` environment, so there is genuinely no DOM here — a
  // reference to one would throw rather than silently work.
  it("has no DOM available, and works anyway", () => {
    expect(typeof document).toBe("undefined");
    const sim = new Simulator({
      spec: `
version: "2.0"
scenarios:
  - id: hello
    when: { command: hello }
    then: { output: ["hi"] }
`,
    });
    expect(sim.execute("hello").lines.map((l) => l.text)).toEqual(["hi"]);
  });

  it("constructs from a spec string alone, with no I/O", () => {
    // Nothing to stub, nothing to await: the constructor takes text.
    expect(
      () => new Simulator({ spec: `version: "2.0"\nscenarios: []` }),
    ).not.toThrow();
  });
});
