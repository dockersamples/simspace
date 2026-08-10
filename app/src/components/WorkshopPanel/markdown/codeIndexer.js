import { visit } from "unist-util-visit";

/**
 * A Remark plugin that adds a data-code-index attribute to code blocks, making
 * it possible to enable the "Run" button (which requires the code block index).
 *
 * `runButtons: "terminal-only"` flips the Run button from opt-out to opt-in: a
 * fence gets one only if it names a terminal with `terminal-id=`. That's what a
 * slide deck wants — most code on a slide is a sample being read, not a command
 * to run, and only a live demo fence targets a terminal.
 *
 * @param {{runButtons?: "default" | "terminal-only"}} [options]
 */
export function remarkCodeIndexer(options = {}) {
  const terminalOnly = options?.runButtons === "terminal-only";
  return (tree) => {
    let i = 0;
    visit(tree, "code", (node) => {
      const codeIndex = i++;

      node.data = node.data || {};
      node.data.codeIndex = codeIndex;
      node.data.hProperties = {
        ...(node.data.hProperties || {}),
        "data-code-index": codeIndex,
      };

      const codeBlockMeta = (node.meta || "").split(/\s+/);

      const highlightConfig = codeBlockMeta.find((m) =>
        m.startsWith("highlight="),
      );
      node.data.hProperties["data-highlight-lines"] = highlightConfig
        ? highlightConfig.split("=")[1]
        : "";

      // `terminal-id=<id>` targets a specific terminal tab for the Run/Save
      // buttons. Empty when unset — the CodeBlock falls back to the primary.
      const terminalIdMeta = codeBlockMeta.find((m) =>
        m.startsWith("terminal-id="),
      );
      node.data.hProperties["data-terminal-id"] = terminalIdMeta
        ? terminalIdMeta.split("=").slice(1).join("=")
        : "";

      const runButtonWanted = terminalOnly ? Boolean(terminalIdMeta) : true;
      node.data.hProperties["data-display-run-button"] =
        runButtonWanted && !codeBlockMeta.includes("no-run-button")
          ? "true"
          : "false";
      node.data.hProperties["data-display-copy-button"] =
        codeBlockMeta.includes("no-copy-button") ? "false" : "true";

      // `filename="compose.yaml"` labels the block's header with a filename
      // instead of the language — the code-window look a deck wants. Purely a
      // label: unlike `save-as`, it writes nothing to the virtual filesystem.
      // Quotes are optional and stripped, since a filename may contain spaces
      // (`Dockerfile · optimized`).
      const filenameMeta = /filename=("[^"]*"|'[^']*'|\S+)/.exec(
        node.meta || "",
      );
      node.data.hProperties["data-filename"] = filenameMeta
        ? filenameMeta[1].replace(/^["']|["']$/g, "")
        : "";

      const saveAsMeta = codeBlockMeta.find((m) => m.startsWith("save-as"));
      node.data.hProperties["data-display-save-as-button"] = saveAsMeta
        ? "true"
        : "false";
      // The target path lives in the meta as `save-as=path/to/file`. The client
      // now writes the file itself (the Go server used to derive this), so
      // surface the path to the CodeBlock component.
      node.data.hProperties["data-save-as-path"] =
        saveAsMeta && saveAsMeta.includes("=")
          ? saveAsMeta.split("=").slice(1).join("=")
          : "";
    });
  };
}
