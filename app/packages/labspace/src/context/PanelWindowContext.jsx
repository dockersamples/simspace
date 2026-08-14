import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// Tracks whether the right-hand pane has been "popped out" into a separate
// browser window. This is a presenter aid: pulling the terminals/services into
// their own window lets an author screen-share just that window during a demo.
//
// Only the boolean lives here. The actual window + React portal are managed by
// <PanelWindow>, which reads this flag; the logo menu toggles it. Keeping the
// panel in the SAME React tree (via a portal, not a second app) means the
// shared Simulator, imperative Run/Save handles, and cross-tab events all keep
// working with no synchronization layer.

const PanelWindowContext = createContext(null);

export function PanelWindowProvider({ children }) {
  const [poppedOut, setPoppedOut] = useState(false);

  const popOut = useCallback(() => setPoppedOut(true), []);
  const dockBack = useCallback(() => setPoppedOut(false), []);
  const toggle = useCallback(() => setPoppedOut((v) => !v), []);

  const value = useMemo(
    () => ({ poppedOut, popOut, dockBack, toggle }),
    [poppedOut, popOut, dockBack, toggle],
  );

  return (
    <PanelWindowContext.Provider value={value}>
      {children}
    </PanelWindowContext.Provider>
  );
}

export const usePanelWindow = () => useContext(PanelWindowContext);
