import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { remarkCodeIndexer } from "./codeIndexer";

// The Run button's default differs between a lab and a deck, and getting it
// wrong is invisible until someone is presenting: a lab fence is a command the
// learner runs, while slide code is overwhelmingly a sample being read aloud.
// Only a fence that names a terminal is a live demo. Worth a unit test because
// the failure is a button that shouldn't be there, on a projector.

/** Run the plugin over some markdown and return each fence's hProperties. */
function index(markdown, options) {
  const tree = unified().use(remarkParse).parse(markdown);
  unified().use(remarkCodeIndexer, options).runSync(tree);
  const out = [];
  visit(tree, "code", (node) => out.push(node.data.hProperties));
  return out;
}

const MARKDOWN = [
  "```bash",
  "docker ps",
  "```",
  "",
  "```dockerfile filename=Dockerfile",
  "FROM golang:1.22",
  "```",
  "",
  "```bash terminal-id=demo",
  "docker run nginx",
  "```",
  "",
  "```bash terminal-id=demo no-run-button",
  "docker run nginx",
  "```",
].join("\n");

const runButtons = (props) =>
  props.map((p) => p["data-display-run-button"] === "true");

describe("remarkCodeIndexer", () => {
  it("gives every fence a Run button by default (a lab)", () => {
    expect(runButtons(index(MARKDOWN))).toEqual([true, true, true, false]);
  });

  it("only gives terminal-targeting fences a Run button in a deck", () => {
    const props = index(MARKDOWN, { runButtons: "terminal-only" });
    expect(runButtons(props)).toEqual([false, false, true, false]);
  });

  it("still records the terminal id and other meta in a deck", () => {
    const props = index(MARKDOWN, { runButtons: "terminal-only" });
    expect(props[2]["data-terminal-id"]).toBe("demo");
    expect(props[1]["data-filename"]).toBe("Dockerfile");
    // Copy is about reading the code, so a deck keeps it everywhere.
    expect(props.every((p) => p["data-display-copy-button"] === "true")).toBe(
      true,
    );
  });

  it("indexes fences in document order regardless of the run-button rule", () => {
    const props = index(MARKDOWN, { runButtons: "terminal-only" });
    expect(props.map((p) => p["data-code-index"])).toEqual([0, 1, 2, 3]);
  });
});
