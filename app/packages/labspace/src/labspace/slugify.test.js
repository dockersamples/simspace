import { describe, expect, it } from "vitest";
import { slugify, substituteVariables } from "./slugify.js";

describe("slugify", () => {
  it("lowercases, strips punctuation, and hyphenates spaces", () => {
    expect(slugify("The Docker CLI")).toBe("the-docker-cli");
    expect(slugify("Find & fix a CVE!")).toBe("find-fix-a-cve");
    expect(slugify("Run   a  container")).toBe("run-a-container");
  });

  // The whole point of the ?? guard: callers write `slugify(x) || fallback`, so
  // a missing title has to be FALSY. `String(undefined)` gave them the truthy
  // string "undefined" instead, and the fallback silently never ran.
  it.each([undefined, null, ""])("slugs %p to the empty string", (input) => {
    expect(slugify(input)).toBe("");
  });
});

describe("substituteVariables", () => {
  it("replaces $$name$$ with the variable's value", () => {
    expect(substituteVariables("run --name $$app$$", { app: "web" })).toBe(
      "run --name web",
    );
  });

  it("leaves the bare name in place when the variable is unset", () => {
    // Better than an empty gap: the reader sees which variable is missing, and
    // the surrounding prose still reads.
    expect(substituteVariables("run --name $$app$$", {})).toBe(
      "run --name app",
    );
    expect(substituteVariables("$$app$$", { app: null })).toBe("app");
  });

  it("substitutes a value of 0 rather than treating it as unset", () => {
    expect(substituteVariables("scale=$$n$$", { n: 0 })).toBe("scale=0");
  });

  it("trims whitespace inside the reference", () => {
    expect(substituteVariables("$$ app $$", { app: "web" })).toBe("web");
  });

  it("unescapes \\$\\$ to a literal $$", () => {
    expect(substituteVariables("costs \\$\\$5", {})).toBe("costs $$5");
  });

  it("handles content that is absent", () => {
    expect(substituteVariables(undefined, {})).toBe("");
  });
});
