import { describe, expect, it } from "vitest";
import { FS, FSError } from "../../src/engine/filesystem";

describe("FS basics", () => {
  it("seeds files and implies their parent directories", () => {
    const fs = new FS({ "app/server.js": "console.log(1);" });
    expect(fs.read("app/server.js")).toBe("console.log(1);");
    expect(fs.isFile("app/server.js")).toBe(true);
    expect(fs.isDir("app")).toBe(true);
    expect(fs.isDir("app/server.js")).toBe(false);
  });

  it("normalizes redundant path segments", () => {
    const fs = new FS({ "./app//server.js": "x" });
    expect(fs.read("app/server.js")).toBe("x");
    expect(fs.list()).toEqual(["app/server.js"]);
  });

  it("returns undefined for a missing file rather than throwing", () => {
    expect(new FS().read("nope.txt")).toBeUndefined();
  });
});

describe("FS mutations", () => {
  it("creates and overwrites", () => {
    const fs = new FS();
    fs.create("a.txt", "one");
    fs.create("a.txt", "two");
    expect(fs.read("a.txt")).toBe("two");
  });

  it("appends to an existing file and creates a missing one", () => {
    const fs = new FS({ "a.txt": "one" });
    fs.append("a.txt", "-two");
    fs.append("new.txt", "fresh");
    expect(fs.read("a.txt")).toBe("one-two");
    expect(fs.read("new.txt")).toBe("fresh");
  });

  it("replaces every occurrence", () => {
    const fs = new FS({ "a.txt": "a b a b a" });
    fs.replace("a.txt", "a", "X");
    expect(fs.read("a.txt")).toBe("X b X b X");
  });

  it("copies a file", () => {
    const fs = new FS({ "a.txt": "body" });
    fs.copy("a.txt", "nested/b.txt");
    expect(fs.read("nested/b.txt")).toBe("body");
    expect(fs.isDir("nested")).toBe(true);
  });

  it("deletes a file, and a directory subtree", () => {
    const fs = new FS({
      "d/one.txt": "1",
      "d/sub/two.txt": "2",
      "keep.txt": "k",
    });
    fs.delete("d");
    expect(fs.list()).toEqual(["keep.txt"]);
  });

  it("does not treat deleting a missing path as an error", () => {
    expect(() => new FS().delete("nope")).not.toThrow();
  });

  it("makes an empty directory visible", () => {
    const fs = new FS();
    fs.mkdir("empty");
    expect(fs.isDir("empty")).toBe(true);
    expect(fs.listDir("")).toEqual([{ name: "empty", isDir: true }]);
  });
});

describe("FS authoring errors fail fast", () => {
  // These throw rather than silently no-op'ing so a broken lab surfaces at the
  // moment it breaks, instead of quietly diverging from what the author wrote.
  it("rejects a replace whose text is absent", () => {
    const fs = new FS({ "a.txt": "hello" });
    expect(() => fs.replace("a.txt", "goodbye", "x")).toThrow(FSError);
    expect(() => fs.replace("a.txt", "goodbye", "x")).toThrow(/text not found/);
  });

  it("rejects a replace on a missing file", () => {
    expect(() => new FS().replace("nope.txt", "a", "b")).toThrow(
      /no such file/,
    );
  });

  it("rejects a replace with an empty find", () => {
    const fs = new FS({ "a.txt": "hello" });
    expect(() => fs.replace("a.txt", "", "x")).toThrow(/non-empty/);
  });

  it("rejects a copy from a missing file", () => {
    expect(() => new FS().copy("nope.txt", "b.txt")).toThrow(/no such file/);
  });
});

describe("FS path containment", () => {
  // The virtual filesystem is lab-relative. Absolute paths and traversal out of
  // the root are rejected so lab content can never address the host shape.
  it("rejects absolute paths", () => {
    expect(() => new FS().create("/etc/passwd", "x")).toThrow(
      /absolute paths are not allowed/,
    );
  });

  it("rejects paths that escape the root", () => {
    expect(() => new FS().create("../outside.txt", "x")).toThrow(
      /escapes lab root/,
    );
    expect(() => new FS().create("app/../../outside.txt", "x")).toThrow(
      /escapes lab root/,
    );
  });

  it("allows traversal that stays inside the root", () => {
    const fs = new FS();
    fs.create("app/sub/../server.js", "x");
    expect(fs.read("app/server.js")).toBe("x");
  });

  it("rejects an empty path", () => {
    expect(() => new FS().create("", "x")).toThrow(/empty path/);
  });

  it("rejects a path that normalizes to nothing", () => {
    expect(() => new FS().create(".", "x")).toThrow(/escapes lab root/);
  });
});

describe("FS listDir", () => {
  const fs = new FS({
    "README.md": "r",
    "app/server.js": "s",
    "app/lib/util.js": "u",
  });

  it("lists the root, marking directories", () => {
    // Sorted with localeCompare, so ordering is case-insensitive collation
    // ("app" before "README.md") rather than ASCII (which would put uppercase
    // first). That's the friendlier order for a learner reading `ls` output.
    expect(fs.listDir("")).toEqual([
      { name: "app", isDir: true },
      { name: "README.md", isDir: false },
    ]);
  });

  it("lists immediate children only", () => {
    expect(fs.listDir("app")).toEqual([
      { name: "lib", isDir: true },
      { name: "server.js", isDir: false },
    ]);
  });

  it("returns sorted entries", () => {
    const messy = new FS({ "c.txt": "", "a.txt": "", "b.txt": "" });
    expect(messy.listDir("").map((e) => e.name)).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
  });

  it("returns nothing for an unknown directory", () => {
    expect(fs.listDir("nope")).toEqual([]);
  });
});
