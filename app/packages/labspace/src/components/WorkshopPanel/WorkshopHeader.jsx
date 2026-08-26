import { useCallback, useEffect, useState } from "react";
import {
  useActiveSection,
  useWorkshop,
} from "../../context/WorkshopContext.jsx";
import { useTerminal } from "../../context/TerminalContext.jsx";
import { useProgress } from "../../context/ProgressContext.jsx";
import { usePanelWindow } from "../../context/PanelWindowContext.jsx";
import { PresenceBar } from "./PresenceBar.jsx";

// Sticky branded header for the instructions pane. Shows the lab identity and a
// segmented progress bar so the learner always knows where they are.
//
// The brand mark hosts a hidden right-click menu with a "Reset lab" action.
// It's deliberately out of the way — resetting clears every terminal and the
// learner's progress, so it's mainly a tool for authors/testers rather than
// learners.
//
// `brand` is the host's identity, not this package's: a logo URL, an eyebrow,
// and where "back" goes. Pass `false` to drop the header entirely when the host
// page already has one. `menuItems` appends host actions to the context menu —
// the lab app adds its offline-cache toggle there, which is a property of that
// app's service worker rather than of the runtime. `showReset` hides just the
// "Reset lab" entry — for a host that keeps the brand header but drives reset
// from its own chrome via `onReady` (mirrors `resetButton` on <Labspace>).
export function WorkshopHeader({
  brand = {},
  menuItems = [],
  showReset = true,
}) {
  const workshop = useWorkshop();
  const { title, sections } = workshop;
  const { activeSection } = useActiveSection();
  const terminal = useTerminal();
  const progress = useProgress();
  const panelWindow = usePanelWindow();
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
        "Reset this lab? Your terminals and progress will be cleared, and you'll start over from the beginning.",
      )
    ) {
      terminal.resetAll();
    }
  }, [terminal, closeMenu]);

  const togglePanelWindow = useCallback(() => {
    closeMenu();
    panelWindow?.toggle();
  }, [panelWindow, closeMenu]);

  // "Reset lab" already clears progress along with the terminals. This is for
  // the rarer case of wanting a clean set of checkmarks without touching the
  // running lab.
  const resetProgress = useCallback(() => {
    closeMenu();
    if (!progress?.resetProgress) return;
    if (
      window.confirm(
        "Reset your progress? This clears your completed-step checkmarks. Your terminals are unaffected.",
      )
    ) {
      progress.resetProgress();
    }
  }, [progress, closeMenu]);

  // Close the menu on Escape while it's open.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeMenu]);

  if (brand === false) return null;

  const { logo, eyebrow, backHref, backLabel = "Back to all labs" } = brand;

  return (
    <header className="workshop-header">
      <div className="workshop-header-bar">
        <div className="workshop-brand">
          {backHref && (
            <a
              href={backHref}
              className="workshop-back-link"
              title={backLabel}
              aria-label={backLabel}
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </a>
          )}
          {logo && (
            <img
              src={logo}
              alt=""
              className="workshop-brand-logo"
              onContextMenu={openMenu}
            />
          )}
          <div className="workshop-brand-text" onContextMenu={openMenu}>
            {eyebrow && (
              <span className="workshop-brand-eyebrow">{eyebrow}</span>
            )}
            <span className="workshop-brand-title" title={title}>
              {title}
            </span>
          </div>
        </div>
        <div className="workshop-header-right">
          <PresenceBar />
          <div className="workshop-progress-count">
            <span className="workshop-progress-current">{current + 1}</span>
            <span className="workshop-progress-total">/ {sections.length}</span>
          </div>
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
            {showReset && (
              <button
                type="button"
                className="workshop-context-menu-item"
                role="menuitem"
                onClick={resetLab}
              >
                <span className="material-symbols-outlined">restart_alt</span>
                Reset lab
              </button>
            )}
            {progress?.hasSteps && (
              <button
                type="button"
                className="workshop-context-menu-item"
                role="menuitem"
                onClick={resetProgress}
              >
                <span className="material-symbols-outlined">check_circle</span>
                Reset progress
              </button>
            )}
            {panelWindow && (
              <button
                type="button"
                className="workshop-context-menu-item"
                role="menuitem"
                onClick={togglePanelWindow}
              >
                <span className="material-symbols-outlined">
                  {panelWindow.poppedOut ? "dock_to_left" : "open_in_new"}
                </span>
                {panelWindow.poppedOut
                  ? "Dock terminal back"
                  : "Open terminal in new window"}
              </button>
            )}
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="workshop-context-menu-item"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  item.onSelect();
                }}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
