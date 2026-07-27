import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { usePanelWindow } from "../../context/PanelWindowContext";
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

export function PanelWindow({ children }) {
  const { poppedOut, dockBack } = usePanelWindow();
  const [container, setContainer] = useState(null);

  useEffect(() => {
    if (!poppedOut) return;

    const win = window.open(
      "",
      "sbxlab-panel",
      "width=960,height=720,menubar=no,toolbar=no,location=no,status=no",
    );

    // Popups are blocked (or otherwise unavailable) — fall back to docked.
    if (!win) {
      toast.error(
        "Couldn't open a new window. Check that pop-ups are allowed for this site.",
      );
      dockBack();
      return;
    }
    win.document.title = "Lab terminal";
    const mount = win.document.createElement("div");
    mount.className = "panel-window-root";
    win.document.body.appendChild(mount);

    const stopStyles = mirrorStyles(document, win.document);
    const stopTheme = mirrorTheme(document, win.document);

    // The child's own X (or the user closing it) docks the pane back in place.
    const handleUnload = () => dockBack();
    win.addEventListener("pagehide", handleUnload);

    // Don't orphan the child window if the main tab is closed or reloaded.
    const closeChild = () => win.close();
    window.addEventListener("pagehide", closeChild);

    setContainer(mount);

    return () => {
      window.removeEventListener("pagehide", closeChild);
      win.removeEventListener("pagehide", handleUnload);
      stopStyles();
      stopTheme();
      setContainer(null);
      win.close();
    };
  }, [poppedOut, dockBack]);

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

// Clone every stylesheet from the source document into the target so the panel
// is styled identically in the child window. In production the app ships one
// hashed <link>; in dev, Vite injects <style> tags (and adds more on HMR), so
// we also observe <head> and copy anything new. Returns a cleanup fn.
function mirrorStyles(src, dst) {
  const selector = 'link[rel="stylesheet"], style';
  const copy = (node) => dst.head.appendChild(node.cloneNode(true));

  // The child is an about:blank document, so relative asset URLs (the app is
  // built with base "./") have nothing to resolve against. Point its base at
  // the main document's URL so cloned <link> hrefs and the fonts they pull in
  // resolve exactly as they do in the opener.
  const base = dst.createElement("base");
  base.href = src.baseURI;
  dst.head.appendChild(base);

  // Give the child a sane baseline: no default body margin, full-height root.
  const baseline = dst.createElement("style");
  baseline.textContent =
    "html,body{margin:0;height:100%}" +
    ".panel-window-root{height:100vh;display:flex;flex-direction:column}";
  dst.head.appendChild(baseline);

  src.head.querySelectorAll(selector).forEach(copy);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.matches?.(selector)) copy(node);
      });
    }
  });
  observer.observe(src.head, { childList: true });

  return () => observer.disconnect();
}

// Keep the child window's Bootstrap theme in sync with the main window — both
// the initial value and any later OS light/dark switch.
function mirrorTheme(src, dst) {
  const apply = () => {
    const theme = src.documentElement.getAttribute("data-bs-theme");
    if (theme) dst.documentElement.setAttribute("data-bs-theme", theme);
    else dst.documentElement.removeAttribute("data-bs-theme");
  };
  apply();

  const observer = new MutationObserver(apply);
  observer.observe(src.documentElement, {
    attributes: true,
    attributeFilter: ["data-bs-theme"],
  });

  return () => observer.disconnect();
}
