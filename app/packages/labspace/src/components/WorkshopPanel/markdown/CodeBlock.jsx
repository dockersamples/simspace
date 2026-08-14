import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// The ESM build of just this one theme, named with its extension.
//
// Two separate traps here. Reaching into `dist/cjs/...` (as this did) hands a
// consumer's bundler a CommonJS module from inside a dependency, which it then
// has to be told about explicitly — and pulls the whole theme barrel to get one
// export. And the `.js` is required because Node resolves this specifier
// directly during a server render; it does not guess extensions.
import darcula from "react-syntax-highlighter/dist/esm/styles/prism/darcula.js";

import copy from "copy-to-clipboard";
import { useCallback } from "react";
import { CodeBlockAction } from "./CodeBlockAction.jsx";
import "./CodeBlock.scss";
import { useTabs } from "../../../context/TabContext.jsx";
import { useTerminal } from "../../../context/TerminalContext.jsx";
import { usePrintMode } from "../../../context/PrintModeContext.jsx";

export function CodeBlock({ node, inline, className, children, ...props }) {
  const { setActiveTab } = useTabs();
  const terminal = useTerminal();
  const printMode = usePrintMode();

  const match = /language-(\w+)/.exec(className || "");
  let language = match ? match[1] : "text";
  if (language === "sh" || language === "console") language = "bash";
  // `prompt` blocks are AI prompts: render as plaintext (no syntax
  // highlighting) but still offer the Run button so the learner can send the
  // prompt into the terminal.
  const isPrompt = language === "prompt";

  // These properties are populated by the codeIndexer remark plugin
  const saveAsPath = node.properties.dataSaveAsPath;
  // A display-only label for the header (`filename=` in the fence meta). Used by
  // deck slides for the code-window look; writes nothing, unlike `save-as`.
  const filename = node.properties.dataFilename;
  // The terminal the Run/Save buttons target. Resolves to the primary terminal
  // when unset or when the id doesn't match a declared terminal.
  const targetTerminalId = terminal.resolveTerminalId(
    node.properties.dataTerminalId,
  );
  const canRun =
    !printMode &&
    node.properties.dataDisplayRunButton === "true" &&
    (language === "bash" || isPrompt);
  const canCopy =
    !printMode && node.properties.dataDisplayCopyButton === "true";
  const canSaveAsFile =
    !printMode && node.properties.dataDisplaySaveAsButton === "true";
  const highlightLines = node.properties.dataHighlightLines
    ? node.properties.dataHighlightLines.split(",").flatMap((s) => {
        const trimmed = s.trim();
        if (trimmed.includes("-")) {
          const [start, end] = trimmed.split("-").map((n) => parseInt(n, 10));
          return Array.from({ length: end - start + 1 }, (_, i) => start + i);
        }
        return parseInt(trimmed, 10);
      })
    : [];

  const onCopyClick = useCallback(() => {
    copy(children);
    return Promise.resolve();
  }, [children]);

  // Feed the code block into the targeted terminal, as if the learner typed it.
  const onRunClick = useCallback(() => {
    setActiveTab(targetTerminalId);
    terminal.runCommand(targetTerminalId, String(children).replace(/\n$/, ""));
    return Promise.resolve();
  }, [children, terminal, setActiveTab, targetTerminalId]);

  // Write the code block to the targeted terminal's virtual filesystem at its
  // `save-as` path.
  const onSaveAsClick = useCallback(() => {
    setActiveTab(targetTerminalId);
    terminal.saveFile(
      targetTerminalId,
      saveAsPath,
      String(children).replace(/\n$/, ""),
    );
    return Promise.resolve();
  }, [children, saveAsPath, terminal, setActiveTab, targetTerminalId]);

  if (!match || inline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  const hasActions = canCopy || canRun || canSaveAsFile;

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-label">
          <span className="material-symbols-outlined code-block-label-icon">
            {saveAsPath || filename ? "draft" : "terminal"}
          </span>
          {saveAsPath || filename ? (
            <span title={saveAsPath || filename}>{saveAsPath || filename}</span>
          ) : (
            <span>{language}</span>
          )}
        </span>
        {hasActions && (
          <div className="button-container d-flex align-items-center">
            {canCopy && (
              <CodeBlockAction
                icon="content_copy"
                onClick={onCopyClick}
                completedText="Copied!"
                tooltip="Copy to clipboard"
              />
            )}
            {canRun && (
              <CodeBlockAction
                icon="play_arrow"
                onClick={onRunClick}
                tooltip="Run in terminal"
              />
            )}
            {canSaveAsFile && (
              <CodeBlockAction
                icon="save"
                onClick={onSaveAsClick}
                completedText="Saved!"
                tooltip="Save file"
              />
            )}
          </div>
        )}
      </div>
      <div className="code-block-body">
        <SyntaxHighlighter
          style={darcula}
          language={isPrompt ? "text" : language}
          PreTag="div"
          className="bg-none"
          wrapLines={highlightLines.length > 0 || printMode}
          wrapLongLines={printMode}
          showLineNumbers={highlightLines.length > 0}
          lineNumberStyle={{ display: "none" }}
          lineProps={(lineNumber) => {
            const lineProps = {
              className: "d-block",
            };
            if (printMode) lineProps.className += " print-line";

            if (highlightLines.includes(lineNumber))
              lineProps.className += " highlight-line"; // Highlight the first line (lineNumber is 1-indexed)

            return lineProps;
          }}
          {...props}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
