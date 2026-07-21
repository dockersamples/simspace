import { useCallback, useEffect, useState } from "react";
import { useActiveSection, useWorkshop } from "../../WorkshopContext";
import { useTerminal } from "../../context/TerminalContext";

// Sticky branded header for the instructions pane. Shows the lab identity and a
// segmented progress bar so the learner always knows where they are.
//
// The Docker logo hosts a hidden right-click menu with a "Reset lab" action.
// It's deliberately out of the way — resetting re-seeds the whole shared
// machine, so it's mainly a tool for authors/testers rather than learners.
export function WorkshopHeader() {
  const { title, sections } = useWorkshop();
  const { activeSection } = useActiveSection();
  const terminal = useTerminal();
  const [menu, setMenu] = useState(null);

  const index = sections.findIndex((s) => s.id === activeSection?.id);
  const current = index < 0 ? 0 : index;

  const openMenu = useCallback((e) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const resetLab = useCallback(() => {
    closeMenu();
    if (!terminal?.resetAll) return;
    if (
      window.confirm(
        "Reset the lab? This clears every terminal and restores the starting state.",
      )
    ) {
      terminal.resetAll();
    }
  }, [terminal, closeMenu]);

  // Close the menu on Escape while it's open.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeMenu]);

  return (
    <header className="workshop-header">
      <div className="workshop-header-bar">
        <div className="workshop-brand">
          <img
            src="docker.svg"
            alt=""
            className="workshop-brand-logo"
            onContextMenu={openMenu}
          />
          <div className="workshop-brand-text">
            <span className="workshop-brand-eyebrow">Labspace</span>
            <span className="workshop-brand-title" title={title}>
              {title}
            </span>
          </div>
        </div>
        <div className="workshop-progress-count">
          <span className="workshop-progress-current">{current + 1}</span>
          <span className="workshop-progress-total">/ {sections.length}</span>
        </div>
      </div>
      <div
        className="workshop-progress-track"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={sections.length}
      >
        {sections.map((section, i) => (
          <span
            key={section.id}
            className={
              "workshop-progress-segment" +
              (i < current ? " is-complete" : "") +
              (i === current ? " is-active" : "")
            }
          />
        ))}
      </div>

      {menu && (
        <>
          <div className="workshop-menu-backdrop" onClick={closeMenu} />
          <div
            className="workshop-context-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
          >
            <button
              type="button"
              className="workshop-context-menu-item"
              role="menuitem"
              onClick={resetLab}
            >
              <span className="material-symbols-outlined">restart_alt</span>
              Reset lab
            </button>
          </div>
        </>
      )}
    </header>
  );
}
