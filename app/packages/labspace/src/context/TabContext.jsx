import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useWorkshop } from "./WorkshopContext.jsx";

// Tabs shown in the right-hand pane. Every declared terminal becomes a tab
// (rendered as a component, not an iframe) — `kind: "terminal"`. When the lab
// enables `features.ci`, a mock CI tab is added — `kind: "ci"`. Any `services`
// declared in labspace.yaml become external-URL iframe tabs, and authors can
// open more via the `tablink` markdown directive — `kind: "service"`.

const TabContext = createContext([]);

// Stable id for the mock CI tab (double-underscored so it can't collide with a
// learner-declared terminal or service id).
export const CI_TAB_ID = "__ci__";

export function TabContextProvider({ children }) {
  const workshop = useWorkshop();
  const [customTabs, setCustomTabs] = useState([]);
  const [labspaceTabOverrides, setLabspaceTabOverrides] = useState({});

  // The declared terminals, always at least one. Their ids are the terminal
  // tab ids, and the first one is the default focus target.
  const terminalTabs = useMemo(
    () =>
      (workshop.terminals || []).map((t) => ({
        id: t.id,
        title: t.title || t.id,
        icon: t.icon || "terminal",
        kind: "terminal",
      })),
    [workshop.terminals],
  );
  const defaultTerminalId = terminalTabs[0]?.id || "terminal";
  const isTerminalId = useCallback(
    (id) => terminalTabs.some((t) => t.id === id),
    [terminalTabs],
  );

  const [activeTab, setActiveTab] = useState(defaultTerminalId);

  const addTab = useCallback((url, title, id) => {
    if (!title) title = url;
    if (!id) id = title;
    setCustomTabs((prevTabs) => [
      ...prevTabs,
      { url, title, id, kind: "service" },
    ]);
    setActiveTab(id);
  }, []);

  const removeTab = useCallback(
    (id) => {
      // Terminal tabs are permanent — only service/custom tabs can be closed.
      if (isTerminalId(id)) return;
      setCustomTabs((prevTabs) => {
        const updatedTabs = prevTabs.filter((tab) => tab.id !== id);

        setActiveTab((prevActiveTab) => {
          if (prevActiveTab === id) {
            const tabIndex = prevTabs.findIndex((tab) => tab.id === id);
            if (updatedTabs.length > 0) {
              const newIndex =
                tabIndex === 0
                  ? 0
                  : Math.min(tabIndex - 1, updatedTabs.length - 1);
              return updatedTabs[newIndex].id;
            }
            return defaultTerminalId;
          }
          return prevActiveTab;
        });

        return updatedTabs;
      });
    },
    [isTerminalId, defaultTerminalId],
  );

  const displayLink = useCallback(
    (url, title, id, icon) => {
      if (!title) title = url;
      if (!id) id = title;

      // A terminal tab has no external URL — just focus it.
      if (isTerminalId(id)) {
        setActiveTab(id);
        return;
      }

      // If the link corresponds to a declared service, override its URL.
      if (workshop.services && workshop.services.find((s) => s.id === id)) {
        setLabspaceTabOverrides((prev) => ({ ...prev, [id]: url }));
        setActiveTab(id);
        return;
      }

      // Otherwise, add it as a custom tab.
      setCustomTabs((prevTabs) => {
        const existingTab = prevTabs.find((tab) => tab.id === id);
        if (existingTab) {
          existingTab.url = url;
          return prevTabs;
        }
        return [...prevTabs, { url, title, id, icon, kind: "service" }];
      });
      setActiveTab(id);
    },
    [workshop.services, isTerminalId],
  );

  // The CI tab is a lab feature (like a service) but rendered as a component,
  // not an iframe. Enabled by `features.ci` in labspace.yaml; title/icon are
  // configurable there.
  const ciFeature = workshop.features?.ci;
  const ciTab = useMemo(
    () =>
      ciFeature
        ? {
            id: CI_TAB_ID,
            title: ciFeature.title || "CI",
            icon: ciFeature.icon || "rocket_launch",
            kind: "ci",
          }
        : null,
    [ciFeature],
  );

  const tabs = useMemo(() => {
    const tabs = [...terminalTabs];

    if (ciTab) tabs.push(ciTab);

    (workshop.services || []).forEach((service) => {
      tabs.push({
        id: service.id,
        url: labspaceTabOverrides[service.id] || service.url,
        icon: service.icon || "link",
        title: service.title || service.id,
        kind: "service",
      });
    });

    tabs.push(...customTabs);
    return tabs;
  }, [
    terminalTabs,
    ciTab,
    workshop.services,
    customTabs,
    labspaceTabOverrides,
  ]);

  return (
    <TabContext.Provider
      value={{ tabs, addTab, removeTab, activeTab, setActiveTab, displayLink }}
    >
      {children}
    </TabContext.Provider>
  );
}

export const useTabs = () => useContext(TabContext);
