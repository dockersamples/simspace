import { useCallback, useEffect, useRef } from "react";
import { MockTerminal } from "@dockersamples/simspace-simulator/react";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { CIPanel } from "./CIPanel.jsx";
import { scopedKey } from "../../labspace/storage.js";
import { useWorkshop } from "../../context/WorkshopContext.jsx";
import { useTabs, CI_TAB_ID } from "../../context/TabContext.jsx";
import { useTerminal } from "../../context/TerminalContext.jsx";
// The icon font. Imported from JS, not `@use`'d from the SCSS: `@use` inlines the
// rules into the importing stylesheet, and sass does not rewrite the relative
// `url()` inside them — so the compiled CSS would look for the font beside
// itself instead of beside icons.css, and every icon would silently 404.
import "../../styles/icons.scss";
import "./TerminalPanel.scss";

// The pane owns the framing (tab bar + border). It hosts one <MockTerminal> per
// declared terminal plus, when the lab defines controls, a Settings "page".
// Terminals stay mounted (their transcripts persist) even when another tab is
// focused, so an agent session and a host shell can run side by side.
const SETTINGS_TAB_ID = "__settings__";

export function TerminalPanel({ showReset = true }) {
  const workshop = useWorkshop();
  const { tabs, activeTab, setActiveTab, removeTab } = useTabs();
  const { register, simulator, error, subscribe, broadcast, resetAll } =
    useTerminal();

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

  // Re-seeds the whole shared machine, so it asks first.
  const confirmReset = useCallback(() => {
    if (
      window.confirm(
        "Reset the lab? This clears every terminal and restores the starting state.",
      )
    ) {
      resetAll();
    }
  }, [resetAll]);

  const handleChange = useCallback(
    (info) => {
      broadcast({ type: "state" });
      // When the command completed a tracked step, fan out a `step` event for
      // the tracking layer (progress store / presence). Kept separate from the
      // `state` event so it never interferes with shared-state persistence.
      if (info?.completes) {
        broadcast({
          type: "step",
          stepId: info.completes,
          scenario: info.matched,
          command: info.line,
          terminalId: info.terminalId,
        });
      }
    },
    [broadcast],
  );

  const terminals = workshop.terminals || [];
  const serviceTabs = tabs.filter((t) => t.kind === "service");
  const hasSettings = (simulator?.lab.controls?.length ?? 0) > 0;
  const ciEnabled = Boolean(workshop.features?.ci);
  // The reset control lives in this bar, so the bar has to exist even for the
  // simplest lab — one terminal, no CI, no controls — which would otherwise have
  // nothing to show and stay hidden.
  const canReset = showReset && Boolean(resetAll);
  const showTabBar = tabs.length > 1 || hasSettings || canReset;

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
    <div className="terminal-panel">
      {showTabBar && (
        <div className="terminal-tabbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={
                "terminal-tab " + (activeTab === tab.id ? "active" : "")
              }
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="material-symbols-outlined terminal-tab-icon">
                {tab.icon}
              </span>
              <span>{tab.title}</span>
              {tab.kind === "service" && activeTab === tab.id && (
                <span
                  role="button"
                  tabIndex={0}
                  className="material-symbols-outlined terminal-tab-close"
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

          <div className="terminal-tabbar-end">
            {canReset && (
              <button
                type="button"
                className="terminal-tab terminal-tab-reset"
                onClick={confirmReset}
                aria-label="Reset lab"
                title="Reset lab"
              >
                <span className="material-symbols-outlined terminal-tab-icon">
                  restart_alt
                </span>
              </button>
            )}
            {hasSettings && (
              <button
                type="button"
                className={
                  "terminal-tab terminal-tab-settings " +
                  (activeTab === SETTINGS_TAB_ID ? "active" : "")
                }
                onClick={() => setActiveTab(SETTINGS_TAB_ID)}
                aria-label="Lab settings"
              >
                <span className="material-symbols-outlined terminal-tab-icon">
                  tune
                </span>
                <span>Settings</span>
              </button>
            )}
          </div>
        </div>
      )}

      {terminals.map((terminal) => (
        <div
          key={terminal.id}
          className="terminal-pane"
          style={{ display: activeTab === terminal.id ? "flex" : "none" }}
        >
          <MockTerminal
            ref={getRefCallback(terminal.id)}
            simulator={simulator}
            error={error}
            terminalId={terminal.id}
            // A lab RESUMES: the transcript is restored on reload, namespaced per
            // terminal and per lab. Embedded terminals elsewhere omit this prop
            // and start clean on every mount.
            storageKey={scopedKey(
              `simspace:terminal:${terminal.id}`,
              workshop.labKey,
            )}
            onChange={handleChange}
            subscribe={subscribe}
            className="terminal-pane"
          />
        </div>
      ))}

      {ciEnabled && (
        <div
          className="terminal-pane"
          style={{ display: activeTab === CI_TAB_ID ? "flex" : "none" }}
        >
          <CIPanel />
        </div>
      )}

      {hasSettings && (
        <div
          className="terminal-pane"
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
