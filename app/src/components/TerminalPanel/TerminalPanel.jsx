import { useEffect, useRef } from "react";
import { SbxTerminal } from "../../terminal/SbxTerminal";
import { useWorkshop } from "../../WorkshopContext";
import { useTabs } from "../../TabContext";
import { useTerminal } from "../../context/TerminalContext";
import "./TerminalPanel.scss";

// The right-hand pane. Always hosts the simulated <SbxTerminal>; any declared
// services / custom tabs render as external iframes. The terminal stays mounted
// (its simulator state is preserved) even when another tab is focused.
export function TerminalPanel() {
  const workshop = useWorkshop();
  const { tabs, activeTab, setActiveTab, removeTab } = useTabs();
  const { register } = useTerminal();
  const termRef = useRef(null);

  useEffect(() => {
    register(termRef.current);
  }, [register]);

  const serviceTabs = tabs.filter((t) => t.id !== "terminal");

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
              {tab.id !== "terminal" && activeTab === tab.id && (
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

      <div
        className="flex-fill"
        style={{ display: activeTab === "terminal" ? "flex" : "none" }}
      >
        <SbxTerminal
          ref={termRef}
          spec={workshop.simulatorSpec}
          files={workshop.files}
          className="flex-fill"
        />
      </div>

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
