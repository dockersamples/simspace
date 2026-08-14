import { useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { usePanelWindow } from "@dockersamples/simspace-labspace";
import { useChildWindow } from "./useChildWindow";
import "./PanelWindow.scss";

// Hosts the right-hand pane's content. Normally it renders its children inline.
// When the pane is "popped out" (see PanelWindowContext), it opens a child
// browser window and renders the SAME children into it via a React portal, so
// nothing about the component tree changes — the shared Simulator, the Run/Save
// imperative handles, CI auto-focus, and reset all keep working untouched. The
// inline slot is replaced by a placeholder so the split layout doesn't shift.
//
// Because a portal follows the React tree rather than the DOM tree, the child
// window is genuinely the same panel, just displayed elsewhere — there is one
// source of truth, exactly like the old iframe, without any message bus.
//
// The window mechanics (opening it, mirroring styles and theme, not orphaning it)
// live in useChildWindow, shared with the deck's popped-out demo terminal and
// speaker notes.

export function PanelWindow({ children }) {
  const { poppedOut, dockBack } = usePanelWindow();

  const onBlocked = useCallback(() => {
    toast.error(
      "Couldn't open a new window. Check that pop-ups are allowed for this site.",
    );
    dockBack();
  }, [dockBack]);

  const container = useChildWindow({
    open: poppedOut,
    title: "Lab terminal",
    name: "sbxlab-panel",
    onBlocked,
    onClosed: dockBack,
  });

  if (!poppedOut) return children;

  return (
    <>
      <PanelPlaceholder onDock={dockBack} />
      {container ? createPortal(children, container) : null}
    </>
  );
}

// Shown in the docked slot while the pane lives in the child window. It keeps
// the split intact (the slot just empties out) and offers a way back.
function PanelPlaceholder({ onDock }) {
  return (
    <div className="panel-window-placeholder">
      <span className="material-symbols-outlined panel-window-placeholder-icon">
        dock_to_right
      </span>
      <p className="panel-window-placeholder-title">
        Terminal opened in a separate window
      </p>
      <p className="panel-window-placeholder-hint">
        Keep that window on screen while you present. Interact with the lab
        there.
      </p>
      <button
        type="button"
        className="panel-window-placeholder-btn"
        onClick={onDock}
      >
        Bring it back here
      </button>
    </div>
  );
}
