import { useTabs } from "../../../TabContext";
import { useTerminal } from "../../../context/TerminalContext";

// There is no real IDE in the static app, so a file link `cat`s the file in the
// simulated terminal (the built-in cat reflects the virtual filesystem).
export function FileLink({ path, children }) {
  const { setActiveTab } = useTabs();
  const terminal = useTerminal();

  return (
    <a
      href={path}
      onClick={(e) => {
        e.preventDefault();
        setActiveTab("terminal");
        terminal.runCommand(`cat ${path}`);
      }}
    >
      {children}
    </a>
  );
}
