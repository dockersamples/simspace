import { useTabs } from "../../../context/TabContext.jsx";
import { useTerminal } from "../../../context/TerminalContext.jsx";

// There is no real IDE in the static app, so a file link `cat`s the file in the
// simulated terminal (the built-in cat reflects the virtual filesystem).
export function FileLink({ path, children, ...props }) {
  const { setActiveTab } = useTabs();
  const terminal = useTerminal();

  // Directive attributes may arrive camelCased or hyphenated depending on the
  // markdown pipeline; accept both. Unset resolves to the primary terminal.
  const targetTerminalId = terminal.resolveTerminalId(
    props.terminalId ?? props["terminal-id"],
  );

  return (
    <a
      href={path}
      onClick={(e) => {
        e.preventDefault();
        setActiveTab(targetTerminalId);
        terminal.runCommand(targetTerminalId, `cat ${path}`);
      }}
    >
      {children}
    </a>
  );
}
