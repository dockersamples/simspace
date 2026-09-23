// The form <-> YAML mapping. These run in the same suite as the server-side
// modules (vitest, node environment) because they are pure functions — the DOM
// rendering around them is verified by using the editor.

import { describe, expect, it } from "vitest";
import {
  argRows,
  captures,
  commandText,
  fileOpVerb,
  getPath,
  moveItem,
  outputRows,
  parseValue,
  setArgRows,
  setCommandText,
  setFileOpVerb,
  setOrDelete,
  setOutputRows,
  setStateRows,
  stateRows,
  toOutputEntry,
  uniqueId,
} from "./model.js";

describe("setOrDelete", () => {
  it("removes a key rather than writing an empty value", () => {
    const obj = { a: 1, b: "x", c: [1], d: { k: 1 } };
    setOrDelete(obj, "a", "");
    setOrDelete(obj, "b", null);
    setOrDelete(obj, "c", []);
    setOrDelete(obj, "d", {});
    expect(obj).toEqual({});
  });

  it("keeps false and zero, which are real values", () => {
    const obj = {};
    setOrDelete(obj, "flag", false);
    setOrDelete(obj, "count", 0);
    expect(obj).toEqual({ flag: false, count: 0 });
  });
});

describe("when.command", () => {
  it("round-trips a token list as a token list", () => {
    const when = { command: ["docker", "run"] };
    expect(commandText(when)).toBe("docker run");
    setCommandText(when, "docker compose up");
    expect(when.command).toEqual(["docker", "compose", "up"]);
  });

  it("round-trips a space-joined string as a string", () => {
    const when = { command: "docker run" };
    setCommandText(when, "docker  compose   up");
    expect(when.command).toBe("docker compose up");
  });

  it("drops the key when the field is cleared", () => {
    const when = { command: ["ls"], terminal: "host" };
    setCommandText(when, "   ");
    expect(when).toEqual({ terminal: "host" });
  });
});

describe("when.args", () => {
  it("reads every matcher form the spec documents", () => {
    const when = {
      args: {
        "--name": "web",
        "-d": true,
        "--rm": false,
        "--tag": { any: true },
        0: { oneOf: ["nginx", "redis"] },
      },
    };
    // Note the order: a positional matcher's key is an integer, and every JS
    // object lists integer-like keys first whatever the file's order. Harmless
    // — the patcher matches map keys by name, not by position.
    expect(argRows(when)).toEqual([
      { name: "0", kind: "oneOf", value: "nginx, redis" },
      { name: "--name", kind: "equals", value: "web" },
      { name: "-d", kind: "present", value: "" },
      { name: "--rm", kind: "absent", value: "" },
      { name: "--tag", kind: "any", value: "" },
    ]);
  });

  it("writes them back in the same forms", () => {
    const when = {};
    setArgRows(when, [
      { name: "--name", kind: "equals", value: "web" },
      { name: "-d", kind: "present" },
      { name: "--rm", kind: "absent" },
      { name: "--tag", kind: "any" },
      { name: "0", kind: "oneOf", value: "nginx , redis" },
      { name: "  ", kind: "equals", value: "ignored" },
    ]);
    expect(when.args).toEqual({
      "--name": "web",
      "-d": true,
      "--rm": false,
      "--tag": { any: true },
      0: { oneOf: ["nginx", "redis"] },
    });
  });

  it("lists the captures a template can reference, without dashes", () => {
    expect(
      captures({
        args: {
          "--name": { any: true },
          "-t": "latest",
          0: { oneOf: ["a"] },
          "-d": true,
          "--rm": false,
        },
      }),
    ).toEqual(["0", "name", "t"]);
  });
});

describe("state rows", () => {
  it("splits the append suffix off the path and puts it back", () => {
    const rows = stateRows({
      "container.running": true,
      "container.events +=": "started",
    });
    expect(rows).toEqual([
      { path: "container.running", append: false, value: "true" },
      { path: "container.events", append: true, value: "started" },
    ]);

    const then = {};
    setStateRows(then, "state", rows);
    expect(then.state).toEqual({
      "container.running": true,
      "container.events +=": "started",
    });
  });

  it("keeps a typed value typed", () => {
    expect(parseValue("true")).toBe(true);
    expect(parseValue("false")).toBe(false);
    expect(parseValue("null")).toBe(null);
    expect(parseValue("42")).toBe(42);
    expect(parseValue("-1.5")).toBe(-1.5);
    expect(parseValue('["a","b"]')).toEqual(["a", "b"]);
    expect(parseValue("web")).toBe("web");
    expect(parseValue("{{ args.name }}")).toBe("{{ args.name }}");
    expect(parseValue("[not json")).toBe("[not json");
  });
});

describe("output entries", () => {
  it("reads bare strings, paced entries and pure pauses", () => {
    expect(
      outputRows([
        "plain",
        { text: "paced", delay: "beat" },
        { text: "raw", delay: 900 },
        { delay: "long" },
      ]),
    ).toEqual([
      { text: "plain", delay: "", pause: false },
      { text: "paced", delay: "beat", pause: false },
      { text: "raw", delay: "900", pause: false },
      { text: "", delay: "long", pause: true },
    ]);
  });

  it("writes back the narrowest form for each row", () => {
    expect(toOutputEntry({ text: "plain", delay: "" })).toBe("plain");
    expect(toOutputEntry({ text: "paced", delay: "beat" })).toEqual({
      text: "paced",
      delay: "beat",
    });
    expect(toOutputEntry({ text: "raw", delay: "900" })).toEqual({
      text: "raw",
      delay: 900,
    });
    expect(toOutputEntry({ text: "", delay: "long", pause: true })).toEqual({
      delay: "long",
    });
  });

  it("keeps an empty line, which is a blank line in the output", () => {
    const then = { output: ["a", "b"] };
    setOutputRows(then, "output", [
      { text: "a", delay: "" },
      { text: "", delay: "" },
      { text: "", delay: "short" },
    ]);
    expect(then.output).toEqual(["a", "", { text: "", delay: "short" }]);
  });

  it("leaves a deliberate empty list alone", () => {
    const then = { output: [] };
    setOutputRows(then, "output", []);
    expect(then.output).toEqual([]);
  });

  it("removes the key when every row is deleted", () => {
    const then = { output: ["a"], exit: 1 };
    setOutputRows(then, "output", []);
    expect(then).toEqual({ exit: 1 });
  });
});

describe("file operations", () => {
  it("switches verb, keeping the path and dropping stale fields", () => {
    const op = { replace: "server.js", find: "a", with: "b" };
    expect(fileOpVerb(op)).toBe("replace");
    setFileOpVerb(op, "create");
    // The path survives, `find`/`with` don't, and `content` is left for the
    // form to fill in rather than being written as an empty string.
    expect(op).toEqual({ create: "server.js" });
  });

  it("drops every other verb so an op never has two", () => {
    const op = { mkdir: "logs" };
    setFileOpVerb(op, "delete");
    expect(op).toEqual({ delete: "logs" });
  });
});

describe("misc", () => {
  it("reads a finding's model path", () => {
    const model = { scenarios: [{ then: { output: ["a", "b"] } }] };
    expect(getPath(model, "scenarios[0].then.output[1]")).toBe("b");
    expect(getPath(model, "scenarios[9].then")).toBeUndefined();
  });

  it("moves a list item and clamps the target", () => {
    const list = [1, 2, 3];
    moveItem(list, 2, 0);
    expect(list).toEqual([3, 1, 2]);
    moveItem(list, 0, 99);
    expect(list).toEqual([1, 2, 3]);
  });

  it("makes a unique id", () => {
    expect(uniqueId("run", ["a"])).toBe("run");
    expect(uniqueId("run", ["run"])).toBe("run-2");
    expect(uniqueId("run", ["run", "run-2"])).toBe("run-3");
  });
});
