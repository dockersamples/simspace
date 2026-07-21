import { useCallback, useRef } from "react";
import { SbxTerminal } from "../../terminal/SbxTerminal";
import { SettingsPanel } from "./SettingsPanel";
import { useWorkshop } from "../../WorkshopContext";
import { useTabs } from "../../TabContext";
import { useTerminal } from "../../context/TerminalContext";
import "./TerminalPanel.scss";

// The pane owns the framing (tab bar + border). It hosts one <SbxTerminal> per
// declared terminal plus, when the lab defines controls, a Settings "page".
// Terminals stay mounted (their transcripts persist) even when another tab is
// focused, so an agent session and a host shell can run side by side.
const SETTINGS_TAB_ID = "__settings__";

export function TerminalPanel() {
  const workshop = useWorkshop();
  const { tabs, activeTab, setActiveTab, removeTab } = useTabs();
  const { register, simulator, error, subscribe, broadcast } = useTerminal();

  // Stable per-id ref callbacks so terminals don't re-register every render.
  const refCallbacks = useRef({});
  const getRefCallback = useCallback(
    (id) => {
      if (!refCallbacks.current[id]) {
        refCallbacks.current[id] = (handle) => register(id, handle);
      }
      return refCallbacks.current[id];
    },
    [register],
  );

  const handleChange = useCallback(
    () => broadcast({ type: "state" }),
    [broadcast],
  );

  const terminals = workshop.terminals || [];
  const serviceTabs = tabs.filter((t) => t.kind === "service");
  const hasSettings = (simulator?.lab.controls?.length ?? 0) > 0;
  const showTabBar = tabs.length > 1 || hasSettings;

  return (
    <div className="terminal-panel d-flex flex-fill flex-column">
      {showTabBar && (
        <div className="terminal-tabbar d-flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                "terminal-tab d-flex align-items-center rounded-top " +
                (activeTab === tab.id ? "active" : "")
              }
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="material-symbols-outlined me-1">{tab.icon}</span>
              <span>{tab.title}</span>
              {tab.kind === "service" && activeTab === tab.id && (
                <span
                  role="button"
                  tabIndex={0}
                  className="material-symbols-outlined ms-2 terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                >
                  close
                </span>
              )}
            </button>
          ))}

          {hasSettings && (
            <button
              type="button"
              className={
                "terminal-tab terminal-tab-settings d-flex align-items-center rounded-top ms-auto " +
                (activeTab === SETTINGS_TAB_ID ? "active" : "")
              }
              onClick={() => setActiveTab(SETTINGS_TAB_ID)}
              aria-label="Lab settings"
            >
              <span className="material-symbols-outlined me-1">tune</span>
              <span>Settings</span>
            </button>
          )}
        </div>
      )}

      {terminals.map((terminal) => (
        <div
          key={terminal.id}
          className="flex-fill"
          style={{ display: activeTab === terminal.id ? "flex" : "none" }}
        >
          <SbxTerminal
            ref={getRefCallback(terminal.id)}
            simulator={simulator}
            error={error}
            terminalId={terminal.id}
            onChange={handleChange}
            subscribe={subscribe}
            className="flex-fill"
          />
        </div>
      ))}

      {hasSettings && (
        <div
          className="flex-fill"
          style={{ display: activeTab === SETTINGS_TAB_ID ? "flex" : "none" }}
        >
          <SettingsPanel />
        </div>
      )}

      {serviceTabs.map((tab) => (
        <iframe
          key={tab.id}
          title={tab.title}
          src={tab.url}
          style={{
            flex: 1,
            border: "none",
            display: activeTab === tab.id ? "block" : "none",
          }}
        />
      ))}
    </div>
  );
}
