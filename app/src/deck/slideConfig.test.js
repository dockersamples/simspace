import { describe, expect, it } from "vitest";
import { parseColumns } from "./slideConfig";

// `columns: 1 2` reaches this function as whatever YAML made of it, which
// depends on how the author wrote it — `1 2` is a string, `[1, 2]` is a list,
// and `2` alone is a number. An author shouldn't have to know the difference,
// and a value we can't read must fall back to equal columns rather than produce
// a stranger layout than the one it replaced.

describe("parseColumns", () => {
  it("reads the space-separated form authors actually write", () => {
    expect(parseColumns("1 2")).toEqual([1, 2]);
    expect(parseColumns("2 1 1")).toEqual([2, 1, 1]);
  });

  it("reads a YAML list", () => {
    expect(parseColumns([2, 1])).toEqual([2, 1]);
  });

  it("accepts comma and colon separators", () => {
    expect(parseColumns("1, 2")).toEqual([1, 2]);
    expect(parseColumns("2:1")).toEqual([2, 1]);
  });

  it("keeps fractional weights", () => {
    expect(parseColumns("1.5 1")).toEqual([1.5, 1]);
  });

  it("falls back to equal columns when unset", () => {
    expect(parseColumns(undefined)).toBeNull();
    expect(parseColumns(null)).toBeNull();
    expect(parseColumns("")).toBeNull();
  });

  it("rejects a partial or nonsensical ratio outright", () => {
    expect(parseColumns("2")).toBeNull(); // one weight describes nothing
    expect(parseColumns("2 wide")).toBeNull();
    expect(parseColumns("2 0")).toBeNull(); // a zero-width column
    expect(parseColumns("2 -1")).toBeNull();
    expect(parseColumns([2, Infinity])).toBeNull();
  });
});
