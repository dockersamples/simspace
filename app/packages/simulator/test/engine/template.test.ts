import { describe, expect, it } from "vitest";
import { Store } from "../../src/engine/state";
import { formatValue, render, renderLines } from "../../src/engine/template";
import { DEFAULT_PACE, resolvePace } from "../../src/engine/types";

describe("render", () => {
  const st = Store.seed({ docker: { running: true }, count: 3, name: "web" });

  it("substitutes captured args", () => {
    expect(render("started {{ args.name }}", { name: "web" }, st)).toBe(
      "started web",
    );
  });

  it("substitutes state dot-paths", () => {
    expect(render("running={{ state.docker.running }}", {}, st)).toBe(
      "running=true",
    );
  });

  it("substitutes interactive input values", () => {
    expect(render("token={{ input.token }}", {}, st, { token: "abc" })).toBe(
      "token=abc",
    );
  });

  it("renders an unknown placeholder as empty rather than leaving it raw", () => {
    // Leaving `{{ args.nope }}` visible in a learner's terminal would read as a
    // bug in the product rather than a gap in the lab.
    expect(render("[{{ args.nope }}]", {}, st)).toBe("[]");
    expect(render("[{{ state.nope }}]", {}, st)).toBe("[]");
    expect(render("[{{ input.nope }}]", {}, st)).toBe("[]");
  });

  it("tolerates whitespace variations inside the braces", () => {
    expect(render("{{args.name}} {{   args.name   }}", { name: "w" }, st)).toBe(
      "w w",
    );
  });

  it("substitutes every occurrence", () => {
    expect(render("{{ args.a }}-{{ args.a }}", { a: "x" }, st)).toBe("x-x");
  });

  it("leaves unrecognized scopes untouched", () => {
    expect(render("{{ env.HOME }}", {}, st)).toBe("{{ env.HOME }}");
  });
});

describe("formatValue", () => {
  it("renders booleans as lowercase words", () => {
    expect(formatValue(true)).toBe("true");
    expect(formatValue(false)).toBe("false");
  });

  it("renders integral numbers without a decimal point", () => {
    expect(formatValue(3)).toBe("3");
    expect(formatValue(3.5)).toBe("3.5");
  });

  it("renders null and undefined as empty", () => {
    expect(formatValue(null)).toBe("");
    expect(formatValue(undefined)).toBe("");
  });

  it("JSON-encodes composite values", () => {
    expect(formatValue(["a", "b"])).toBe('["a","b"]');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("renderLines", () => {
  const st = Store.seed({});
  const pace = resolvePace(undefined);

  it("treats a bare string as a line at the default cadence", () => {
    expect(renderLines(["hello"], {}, st, pace)).toEqual([{ text: "hello" }]);
  });

  it("resolves a named delay through the pace profiles", () => {
    expect(
      renderLines([{ text: "slow", delay: "medium" }], {}, st, pace),
    ).toEqual([{ text: "slow", delayMs: DEFAULT_PACE.medium }]);
  });

  it("uses a numeric delay verbatim", () => {
    expect(renderLines([{ text: "x", delay: 42 }], {}, st, pace)).toEqual([
      { text: "x", delayMs: 42 },
    ]);
  });

  it("clamps a negative delay to zero", () => {
    expect(renderLines([{ text: "x", delay: -5 }], {}, st, pace)).toEqual([
      { text: "x", delayMs: 0 },
    ]);
  });

  it("resolves an unknown delay name to zero", () => {
    expect(renderLines([{ text: "x", delay: "nope" }], {}, st, pace)).toEqual([
      { text: "x", delayMs: 0 },
    ]);
  });

  it("turns a text-less entry into a pure pause that renders nothing", () => {
    expect(renderLines([{ delay: "short" }], {}, st, pace)).toEqual([
      { text: "", pause: true, delayMs: DEFAULT_PACE.short },
    ]);
  });

  it("returns nothing for absent output", () => {
    expect(renderLines(undefined, {}, st, pace)).toEqual([]);
  });

  it("lets a lab retune a built-in pace profile", () => {
    const custom = resolvePace({ pace: { medium: 1 } });
    expect(custom.medium).toBe(1);
    // Unspecified profiles keep their built-in values.
    expect(custom.short).toBe(DEFAULT_PACE.short);
  });
});
