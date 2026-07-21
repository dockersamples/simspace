import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { darcula } from "react-syntax-highlighter/dist/cjs/styles/prism";

import copy from "copy-to-clipboard";
import { useCallback } from "react";
import { CodeBlockAction } from "./CodeBlockAction";
import { useTabs } from "../../../TabContext";
import { useTerminal } from "../../../context/TerminalContext";
import { usePrintMode } from "../../../PrintModeContext";

export function CodeBlock({ node, inline, className, children, ...props }) {
  const { setActiveTab } = useTabs();
  const terminal = useTerminal();
  const printMode = usePrintMode();

  const match = /language-(\w+)/.exec(className || "");
  let language = match ? match[1] : "text";
  if (language === "sh" || language === "console") language = "bash";

  // These properties are populated by the codeIndexer remark plugin
  const saveAsPath = node.properties.dataSaveAsPath;
  const canRun =
    !printMode &&
    node.properties.dataDisplayRunButton === "true" &&
    language === "bash";
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

  // Feed the code block into the simulated terminal, as if the learner typed it.
  const onRunClick = useCallback(() => {
    setActiveTab("terminal");
    terminal.runCommand(String(children).replace(/\n$/, ""));
    return Promise.resolve();
  }, [children, terminal, setActiveTab]);

  // Write the code block to the virtual filesystem at its `save-as` path.
  const onSaveAsClick = useCallback(() => {
    setActiveTab("terminal");
    terminal.saveFile(saveAsPath, String(children).replace(/\n$/, ""));
    return Promise.resolve();
  }, [children, saveAsPath, terminal, setActiveTab]);

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
            {saveAsPath ? "draft" : "terminal"}
          </span>
          {saveAsPath ? (
            <span title={saveAsPath}>{saveAsPath}</span>
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
          language={language}
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
