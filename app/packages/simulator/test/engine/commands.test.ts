import { describe, expect, it } from "vitest";
import { parseCommand, tokenize } from "../../src/engine/commands";

describe("tokenize", () => {
  it("splits on whitespace and collapses runs", () => {
    expect(tokenize("docker   run  -d")).toEqual(["docker", "run", "-d"]);
    expect(tokenize("\tdocker\tps\t")).toEqual(["docker", "ps"]);
  });

  it("keeps a quoted phrase as one token and strips the quotes", () => {
    // The browser hands the engine one raw string, unlike a real shell that
    // pre-splits argv — so quoting has to be honored here or `-p "a b c"`
    // would arrive as four tokens.
    expect(tokenize(`agent run -p "add a health endpoint"`)).toEqual([
      "agent",
      "run",
      "-p",
      "add a health endpoint",
    ]);
    expect(tokenize(`echo 'single quoted'`)).toEqual(["echo", "single quoted"]);
  });

  it("treats an explicit empty quoted string as a real token", () => {
    expect(tokenize(`set name ""`)).toEqual(["set", "name", ""]);
  });

  it("returns no tokens for blank input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("parseCommand", () => {
  it("separates positionals from flags", () => {
    const cmd = parseCommand(["docker", "run", "-d", "nginx"]);
    // `-d` consumes the following token as its value, so "nginx" is NOT a
    // positional here — a quirk worth pinning down, since it decides whether an
    // author writes `args: { 0: nginx }` or `args: { d: nginx }`.
    expect(cmd.tokens).toEqual(["docker", "run"]);
    expect(cmd.flags).toEqual({ d: "nginx" });
  });

  it("parses --key=value", () => {
    const cmd = parseCommand(["docker", "run", "--name=web"]);
    expect(cmd.tokens).toEqual(["docker", "run"]);
    expect(cmd.flags).toEqual({ name: "web" });
  });

  it("parses --key value", () => {
    const cmd = parseCommand(["docker", "run", "--name", "web", "nginx"]);
    expect(cmd.flags).toEqual({ name: "web" });
    expect(cmd.tokens).toEqual(["docker", "run", "nginx"]);
  });

  it("maps a trailing flag to an empty value", () => {
    expect(parseCommand(["docker", "ps", "-a"]).flags).toEqual({ a: "" });
  });

  it("maps a flag followed by another flag to an empty value", () => {
    const cmd = parseCommand(["docker", "ps", "-a", "-q"]);
    expect(cmd.flags).toEqual({ a: "", q: "" });
  });

  it("strips leading dashes from flag names", () => {
    expect(parseCommand(["x", "--long"]).flags).toHaveProperty("long");
    expect(parseCommand(["x", "-s"]).flags).toHaveProperty("s");
  });

  it("treats a bare dash as positional", () => {
    expect(parseCommand(["cat", "-"]).tokens).toEqual(["cat", "-"]);
  });

  it("records the reconstructed line for history", () => {
    expect(parseCommand(["docker", "ps", "-a"]).line).toBe("docker ps -a");
  });
});
