import { useCallback, useEffect, useRef } from "react";
import { MockTerminal } from "../../terminal/MockTerminal";
import { SettingsPanel } from "./SettingsPanel";
import { CIPanel } from "./CIPanel";
import { useWorkshop } from "../../WorkshopContext";
import { useTabs, CI_TAB_ID } from "../../TabContext";
import { useTerminal } from "../../context/TerminalContext";
import "./TerminalPanel.scss";

// The pane owns the framing (tab bar + border). It hosts one <MockTerminal> per
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
  const ciEnabled = Boolean(workshop.features?.ci);
  const showTabBar = tabs.length > 1 || hasSettings;

  // When a new CI run appears (from a `git push` in any terminal), bring the CI
  // tab forward so the learner sees the pipeline fire. Compares the run count on
  // each shared-state event; a reset zeroes the baseline.
  const prevRunCountRef = useRef(0);
  useEffect(() => {
    if (!ciEnabled || !subscribe || !simulator) return;
    const readCount = () => {
      const runs = simulator.getState("ci.runs");
      return Array.isArray(runs) ? runs.length : 0;
    };
    prevRunCountRef.current = readCount();
    return subscribe((event) => {
      if (event.type === "reset") {
        prevRunCountRef.current = 0;
        return;
      }
      const count = readCount();
      if (count > prevRunCountRef.current) {
        setActiveTab(CI_TAB_ID);
      }
      prevRunCountRef.current = count;
    });
  }, [ciEnabled, subscribe, simulator, setActiveTab]);

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
          // min-height: 0 lets this flex child shrink below its content height,
          // so the terminal's own body becomes the scroll container. Without it
          // the wrapper grows past the pane and streaming output is clipped
          // (invisible) until something forces a scroll. See MockTerminal.
          style={{
            minHeight: 0,
            display: activeTab === terminal.id ? "flex" : "none",
          }}
        >
          <MockTerminal
            ref={getRefCallback(terminal.id)}
            simulator={simulator}
            error={error}
            terminalId={terminal.id}
            labKey={workshop.labKey}
            onChange={handleChange}
            subscribe={subscribe}
            className="flex-fill"
          />
        </div>
      ))}

      {ciEnabled && (
        <div
          className="flex-fill"
          style={{
            minHeight: 0,
            display: activeTab === CI_TAB_ID ? "flex" : "none",
          }}
        >
          <CIPanel />
        </div>
      )}

      {hasSettings && (
        <div
          className="flex-fill"
          style={{
            minHeight: 0,
            display: activeTab === SETTINGS_TAB_ID ? "flex" : "none",
          }}
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
