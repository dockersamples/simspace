import { visit } from "unist-util-visit";

/**
 * A Remark plugin that adds a data-code-index attribute to code blocks, making
 * it possible to enable the "Run" button (which requires the code block index).
 * @returns
 */
export function remarkCodeIndexer() {
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

      node.data.hProperties["data-display-run-button"] = codeBlockMeta.includes(
        "no-run-button",
      )
        ? "false"
        : "true";
      node.data.hProperties["data-display-copy-button"] =
        codeBlockMeta.includes("no-copy-button") ? "false" : "true";
      // `terminal-id=<id>` targets a specific terminal tab for the Run/Save
      // buttons. Empty when unset — the CodeBlock falls back to the primary.
      const terminalIdMeta = codeBlockMeta.find((m) =>
        m.startsWith("terminal-id="),
      );
      node.data.hProperties["data-terminal-id"] = terminalIdMeta
        ? terminalIdMeta.split("=").slice(1).join("=")
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
