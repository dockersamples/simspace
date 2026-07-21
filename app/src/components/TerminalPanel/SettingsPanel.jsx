import { useCallback, useEffect, useState } from "react";
import { useTerminal } from "../../context/TerminalContext";
import "./SettingsPanel.scss";

// Derives each control's on/off from the shared simulator's current state, so
// the toggles reflect changes made from any terminal (not just this page).
function deriveControlValues(sim) {
  if (!sim?.lab.controls?.length) return {};
  return Object.fromEntries(
    sim.lab.controls.map((c) => [
      c.id,
      JSON.stringify(sim.getState(c.state)) === JSON.stringify(c.enabled),
    ]),
  );
}

// A Docker-admin-style settings "page" (rendered as a tab in the terminal
// pane). Lab controls become toggle rows that write the shared simulator state;
// toggling from here is visible in every terminal, and state changed elsewhere
// is reflected back here via the terminal event bus.
export function SettingsPanel() {
  const { simulator, subscribe, broadcast } = useTerminal();
  const [values, setValues] = useState(() => deriveControlValues(simulator));

  useEffect(() => {
    setValues(deriveControlValues(simulator));
  }, [simulator]);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(() => setValues(deriveControlValues(simulator)));
  }, [subscribe, simulator]);

  const toggle = useCallback(
    (control, on) => {
      if (!simulator) return;
      simulator.setControl(
        control.state,
        on ? control.enabled : control.disabled,
      );
      setValues((prev) => ({ ...prev, [control.id]: on }));
      broadcast?.({ type: "state" });
    },
    [simulator, broadcast],
  );

  const controls = simulator?.lab.controls ?? [];

  return (
    <div className="settings-panel">
      <div className="settings-scroll">
        <header className="settings-head">
          <h2 className="settings-title">Lab settings</h2>
          <p className="settings-subtitle">
            Toggle the simulated conditions for this lab.
          </p>
        </header>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="material-symbols-outlined settings-card-icon">
              tune
            </span>
            <span className="settings-card-title">Simulated conditions</span>
          </div>

          {controls.length === 0 ? (
            <div className="settings-empty">
              This lab has no configurable settings.
            </div>
          ) : (
            <ul className="settings-list">
              {controls.map((control) => (
                <li key={control.id} className="settings-row">
                  <div className="settings-row-text">
                    <span className="settings-row-label">{control.label}</span>
                    {control.description && (
                      <span className="settings-row-desc">
                        {control.description}
                      </span>
                    )}
                  </div>
                  <label className="sbx-toggle">
                    <input
                      type="checkbox"
                      checked={values[control.id] ?? false}
                      onChange={(e) => toggle(control, e.target.checked)}
                    />
                    <span className="sbx-toggle-track" />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
