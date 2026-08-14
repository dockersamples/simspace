import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveSection, useWorkshop } from "../../context/WorkshopContext";
import { useProgress } from "../../context/ProgressContext";
import { AvatarStack } from "./AvatarStack";
import "./WorkshopNav.scss";

// The section picker in the footer: a button that opens a list of every section
// upward, centred over itself.
//
// Hand-rolled rather than a dropdown component, because the whole popover is one
// absolutely-positioned list — the dependency bought a caret we hid, a
// positioning engine we overrode, and item styles we replaced.
export function WorkshopNav() {
  const { sections } = useWorkshop();
  const { activeSection, changeActiveSection } = useActiveSection();
  const progress = useProgress();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const index = sections.findIndex((s) => s.id === activeSection?.id);

  // Live presence by reading position, so learners can see where others are as
  // they move through the lab. Only shown when a backend is connected.
  const perSection = progress?.presence?.perSection || {};
  const presenceAvatars = progress?.presence?.avatars || [];
  const ownId = progress?.actor?.id;

  const close = useCallback(() => setOpen(false), []);

  // Dismiss on an outside press or Escape — the two things a reader expects of
  // an open menu, and all a dropdown library was doing for us here.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="workshop-nav" ref={rootRef}>
      <button
        type="button"
        className={"workshop-nav-toggle" + (open ? " is-open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="workshop-nav-toggle-index">{index + 1}</span>
        <span className="workshop-nav-toggle-title">
          {activeSection ? activeSection.title : "Sections"}
        </span>
        <span className="material-symbols-outlined workshop-nav-toggle-caret">
          unfold_more
        </span>
      </button>

      {open && (
        <div className="workshop-nav-menu" role="menu">
          {sections.map((section, i) => {
            const isActive = activeSection?.id === section.id;
            const isComplete = progress?.isSectionComplete?.(section) ?? false;
            const here = perSection[section.id] || 0;
            const hereAvatars = presenceAvatars.filter(
              (a) => a.sectionId === section.id,
            );
            return (
              <button
                key={section.id}
                type="button"
                role="menuitem"
                className={"workshop-nav-item" + (isActive ? " is-active" : "")}
                onClick={() => {
                  changeActiveSection(section.id);
                  close();
                }}
              >
                <span className="workshop-nav-item-index">{i + 1}</span>
                <span className="workshop-nav-item-title">{section.title}</span>
                {here > 0 && (
                  <span
                    className="workshop-nav-item-presence"
                    title={`${here} here now`}
                  >
                    <AvatarStack
                      avatars={hereAvatars}
                      total={here}
                      ownId={ownId}
                      max={2}
                      size="sm"
                    />
                  </span>
                )}
                {isComplete ? (
                  <span className="material-symbols-outlined workshop-nav-item-check is-complete">
                    check_circle
                  </span>
                ) : isActive ? (
                  <span className="material-symbols-outlined workshop-nav-item-check">
                    check
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
