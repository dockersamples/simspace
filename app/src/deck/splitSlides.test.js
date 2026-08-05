import { describe, expect, it } from "vitest";
import { extractNotes, parseSlides, splitChunks } from "./splitSlides";

describe("splitChunks", () => {
  it("splits on a --- line", () => {
    expect(splitChunks("one\n---\ntwo")).toEqual(["one", "two"]);
  });

  it("returns a single chunk when there is no separator", () => {
    expect(splitChunks("just one slide")).toEqual(["just one slide"]);
  });

  it("tolerates indentation and trailing spaces on the separator", () => {
    expect(splitChunks("one\n  ---  \ntwo")).toHaveLength(2);
  });

  it("does not split on a --- that is part of a longer rule", () => {
    // `----` is a horizontal rule, not a slide break — a slide can still contain
    // an <hr> if the author writes four or more dashes.
    expect(splitChunks("one\n----\ntwo")).toHaveLength(1);
  });

  it("does not split on text that merely contains dashes", () => {
    expect(splitChunks("one\nsome --- text\ntwo")).toHaveLength(1);
  });

  describe("inside fenced code blocks", () => {
    // The case that matters most: a `---` in a code sample is content. Splitting
    // there tears the fence and every later slide renders as garbage.
    it("ignores a --- inside a backtick fence", () => {
      const md = ["# YAML", "", "```yaml", "a: 1", "---", "b: 2", "```"].join(
        "\n",
      );
      expect(splitChunks(md)).toHaveLength(1);
    });

    it("ignores a --- inside a tilde fence", () => {
      const md = ["~~~", "---", "~~~"].join("\n");
      expect(splitChunks(md)).toHaveLength(1);
    });

    it("still splits after a fence has closed", () => {
      const md = ["```", "code", "```", "---", "next"].join("\n");
      expect(splitChunks(md)).toHaveLength(2);
    });

    it("keeps a longer fence open across a shorter marker inside it", () => {
      // How an author shows a code fence to the reader: the outer ```` fence must
      // not be closed by the inner ``` line, or the --- after it would split.
      const md = [
        "````markdown",
        "```bash",
        "docker ps",
        "```",
        "---",
        "still inside",
        "````",
        "---",
        "a real break",
      ].join("\n");
      const chunks = splitChunks(md);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toContain("still inside");
      expect(chunks[1].trim()).toBe("a real break");
    });

    it("handles a fence that is never closed", () => {
      // Malformed markdown shouldn't lose content — everything after the opener
      // stays on one slide rather than disappearing.
      const md = ["```", "code", "---", "more"].join("\n");
      const chunks = splitChunks(md);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain("more");
    });
  });

  it("treats a leading --- as front matter, not a break", () => {
    const md = ["---", "title: My deck", "---", "# First slide"].join("\n");
    // The opening line is front matter; the closing one is a real separator, so
    // the front matter ends up as its own leading chunk.
    const chunks = splitChunks(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].trim()).toBe("# First slide");
  });
});

describe("extractNotes", () => {
  it("splits a Note: line off the body", () => {
    const { content, notes } = extractNotes(
      "# Slide\n\nNote: say this out loud",
    );
    expect(content.trim()).toBe("# Slide");
    expect(notes).toBe("say this out loud");
  });

  it("takes every line after Note: as part of the notes", () => {
    const { content, notes } = extractNotes(
      ["# Slide", "", "Note: first", "second", "third"].join("\n"),
    );
    expect(content.trim()).toBe("# Slide");
    expect(notes).toBe("first\nsecond\nthird");
  });

  it("returns empty notes when there is no marker", () => {
    expect(extractNotes("# Slide").notes).toBe("");
  });

  it("keeps a Note: that is only mentioned mid-sentence", () => {
    const { notes } = extractNotes("Please Note: this is body text");
    expect(notes).toBe("");
  });

  it("handles a bare Note: with content only on following lines", () => {
    const { notes } = extractNotes("# Slide\n\nNote:\nthe real note");
    expect(notes).toBe("the real note");
  });
});

describe("parseSlides", () => {
  it("numbers slide ids from 1 within a chapter", () => {
    const slides = parseSlides("a\n---\nb\n---\nc", { chapterId: "intro" });
    expect(slides.map((s) => s.id)).toEqual(["intro-1", "intro-2", "intro-3"]);
  });

  it("carries the chapter id and base url onto every slide", () => {
    const slides = parseSlides("a\n---\nb", {
      chapterId: "intro",
      baseUrl: "https://example.com/labs/deck/",
    });
    expect(slides[0].chapterId).toBe("intro");
    expect(slides[0].baseUrl).toBe("https://example.com/labs/deck/");
  });

  it("trims each slide's body", () => {
    expect(parseSlides("\n\n# A\n\n\n", { chapterId: "c" })[0].content).toBe(
      "# A",
    );
  });

  it("drops empty chunks so a stray separator adds no blank slide", () => {
    const slides = parseSlides("a\n---\n\n---\nb", { chapterId: "c" });
    expect(slides.map((s) => s.content)).toEqual(["a", "b"]);
  });

  it("drops a trailing separator", () => {
    expect(parseSlides("a\n---\n", { chapterId: "c" })).toHaveLength(1);
  });

  it("keeps a notes-only slide as a deliberate say-this-show-nothing beat", () => {
    const slides = parseSlides("a\n---\nNote: just talk here", {
      chapterId: "c",
    });
    expect(slides).toHaveLength(2);
    expect(slides[1].content).toBe("");
    expect(slides[1].notes).toBe("just talk here");
  });

  it("returns nothing for empty or missing markdown", () => {
    expect(parseSlides("", { chapterId: "c" })).toEqual([]);
    expect(parseSlides(undefined, { chapterId: "c" })).toEqual([]);
  });

  it("keeps ids stable when a heading is renamed", () => {
    // Ids are positional precisely so editing prose doesn't invalidate a
    // learner's recorded progress.
    const before = parseSlides("# Old title\n---\n# Second", {
      chapterId: "c",
    });
    const after = parseSlides("# New title\n---\n# Second", { chapterId: "c" });
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
  });
});
