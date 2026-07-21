import { useCallback, useRef } from "react";
import { SbxTerminal } from "../../terminal/SbxTerminal";
import { useWorkshop } from "../../WorkshopContext";
import { useTabs } from "../../TabContext";
import { useTerminal } from "../../context/TerminalContext";
import "./TerminalPanel.scss";

// The right-hand pane. Hosts one simulated <SbxTerminal> per declared terminal
// plus any service iframes. Every terminal stays mounted (its simulator state is
// preserved) even when another tab is focused, so an agent session and a host
// shell can run side by side.
export function TerminalPanel() {
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

  const handleChange = useCallback(
    () => broadcast({ type: "state" }),
    [broadcast],
  );

  const terminals = workshop.terminals || [];
  const serviceTabs = tabs.filter((t) => t.kind === "service");

  return (
    <div className="terminal-panel d-flex flex-fill flex-column">
      {tabs.length > 1 && (
        <div className="p-2 bg-dark border-bottom border-light-subtle d-flex gap-2">
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
            onReset={resetAll}
            className="flex-fill"
          />
        </div>
      ))}

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
