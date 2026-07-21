import { createContext, useCallback, useContext, useRef } from "react";

// Holds an imperative handle to the mounted <SbxTerminal>. The TerminalPanel
// registers the terminal's handle here; the instructions panel (Run / Save
// buttons, file links) drives the simulator through it — no server round-trip.

const TerminalContext = createContext(null);

export function TerminalContextProvider({ children }) {
  const handleRef = useRef(null);

  const register = useCallback((handle) => {
    handleRef.current = handle;
  }, []);

  const runCommand = useCallback((text) => {
    handleRef.current?.runCommand(text);
  }, []);

  const saveFile = useCallback((path, content) => {
    handleRef.current?.saveFile(path, content);
  }, []);

  return (
    <TerminalContext.Provider value={{ register, runCommand, saveFile }}>
      {children}
    </TerminalContext.Provider>
  );
}

export const useTerminal = () => useContext(TerminalContext);
