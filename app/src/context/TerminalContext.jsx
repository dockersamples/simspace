import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { Simulator } from "../engine/simulator";
import { useVariables, useWorkshop } from "../WorkshopContext";

// Owns the single Simulator shared by every terminal in the pane. All terminals
// read and write the same state store and virtual filesystem — like two shells
// on one machine — so a change made in one is visible to the others. Each
// terminal keeps only its own on-screen transcript.
//
// The instructions panel (Run / Save buttons, file links) drives a chosen
// terminal through the registered imperative handles; scenarios can scope
// themselves to a terminal via `when.terminal`.

const TerminalContext = createContext(null);

const ENGINE_KEY = "simspace:engine";

export function TerminalContextProvider({ children }) {
  const workshop = useWorkshop();
  const { resetVariables } = useVariables();
  const handlesRef = useRef({});
  const listenersRef = useRef(new Set());

  const terminals = useMemo(() => workshop.terminals || [], [workshop]);
  const defaultTerminalId = terminals[0]?.id || "terminal";

  // Build ONE Simulator for all terminals. Stringify the seed files so a new
  // object with identical contents doesn't force a needless rebuild.
  const filesKey = JSON.stringify(workshop.files ?? {});
  const { simulator, error } = useMemo(() => {
    try {
      let restoredState, restoredFiles;
      try {
        const saved = localStorage.getItem(ENGINE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          restoredState = parsed.state;
          restoredFiles = parsed.files;
        }
      } catch { /* ignore storage errors */ }
      return {
        simulator: new Simulator({
          spec: workshop.simulatorSpec,
          files: workshop.files ?? {},
          restoredState,
          restoredFiles,
        }),
        error: null,
      };
    } catch (e) {
      return { simulator: null, error: e.message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshop.simulatorSpec, filesKey]);

  // Pub/sub so a change (or reset) in one terminal can refresh the others —
  // e.g. keeping every terminal's Settings toggles in sync with shared state.
  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);
  const broadcast = useCallback((event) => {
    listenersRef.current.forEach((fn) => fn(event));
    if (event.type === "state" && simulator) {
      try {
        localStorage.setItem(ENGINE_KEY, JSON.stringify({
          state: simulator.state(),
          files: simulator.files(),
        }));
      } catch { /* storage may be full or unavailable */ }
    }
  }, [simulator]);

  // Reset re-seeds the shared machine once, then tells every terminal to clear
  // its transcript and re-greet.
  const resetAll = useCallback(() => {
    if (!simulator) return;
    try { localStorage.removeItem(ENGINE_KEY); } catch { /* ignore */ }
    resetVariables();
    simulator.reset();
    broadcast({ type: "reset" });
  }, [simulator, broadcast, resetVariables]);

  const register = useCallback((id, handle) => {
    if (handle) handlesRef.current[id] = handle;
    else delete handlesRef.current[id];
  }, []);

  const runCommand = useCallback(
    (id, text) => {
      const target =
        handlesRef.current[id] || handlesRef.current[defaultTerminalId];
      target?.runCommand(text);
    },
    [defaultTerminalId],
  );

  const saveFile = useCallback(
    (id, path, content) => {
      const target =
        handlesRef.current[id] || handlesRef.current[defaultTerminalId];
      target?.saveFile(path, content);
    },
    [defaultTerminalId],
  );

  // Resolves a requested terminal id to a real one, falling back to the primary
  // terminal when the id is missing or unknown (e.g. a typo'd `terminal-id`).
  const resolveTerminalId = useCallback(
    (id) => (id && terminals.some((t) => t.id === id) ? id : defaultTerminalId),
    [terminals, defaultTerminalId],
  );

  const value = useMemo(
    () => ({
      simulator,
      error,
      subscribe,
      broadcast,
      resetAll,
      register,
      runCommand,
      saveFile,
      terminals,
      defaultTerminalId,
      resolveTerminalId,
    }),
    [
      simulator,
      error,
      subscribe,
      broadcast,
      resetAll,
      register,
      runCommand,
      saveFile,
      terminals,
      defaultTerminalId,
      resolveTerminalId,
    ],
  );

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export const useTerminal = () => useContext(TerminalContext);
