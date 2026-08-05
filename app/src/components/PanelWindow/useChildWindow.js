import { useEffect, useState } from "react";

// Opens a real second browser window and returns a DOM node inside it to render
// into via a React portal. Because a portal follows the React tree rather than
// the DOM tree, whatever you render there is genuinely the same component — same
// state, same handles, no message bus — just displayed elsewhere.
//
// Three surfaces want this, which is why it's a hook rather than living inside
// one of them: the lab's popped-out terminal pane, a deck's popped-out demo
// terminal (deck on the projector, terminal on the laptop), and a deck's speaker
// notes.
//
// The child is an `about:blank` document, so it starts with no styles at all.
// Everything below is about making it look like the opener and stay that way.

/**
 * @param {object}   opts
 * @param {boolean}  opts.open        whether the window should be open
 * @param {string}   opts.title       the child window's document title
 * @param {string}   opts.name        window name — reused, so one per purpose
 * @param {string}   [opts.features]  window.open feature string
 * @param {Function} [opts.onBlocked] called when the popup was blocked
 * @param {Function} [opts.onClosed]  called when the user closes the child
 * @returns {Node|null} the mount node, or null while closed/unavailable
 */
export function useChildWindow({
  open,
  title,
  name,
  features = "width=960,height=720,menubar=no,toolbar=no,location=no,status=no",
  onBlocked,
  onClosed,
}) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    if (!open) return undefined;

    const win = window.open("", name, features);
    if (!win) {
      onBlocked?.();
      return undefined;
    }

    win.document.title = title;
    const mount = win.document.createElement("div");
    mount.className = "child-window-root";
    win.document.body.appendChild(mount);

    const stopStyles = mirrorStyles(document, win.document);
    const stopTheme = mirrorTheme(document, win.document);

    // The child's own X (or the user closing it) tells the opener to dock back.
    const handleUnload = () => onClosed?.();
    win.addEventListener("pagehide", handleUnload);

    // Don't orphan the child if the main tab is closed or reloaded.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, title, features]);

  return container;
}

// Clone every stylesheet from the source document into the target so the content
// is styled identically in the child window. In production the app ships one
// hashed <link>; in dev, Vite injects <style> tags (and adds more on HMR), so we
// also observe <head> and copy anything new. Returns a cleanup fn.
export function mirrorStyles(src, dst) {
  const selector = 'link[rel="stylesheet"], style';
  const copy = (node) => dst.head.appendChild(node.cloneNode(true));

  // The child is an about:blank document, so relative asset URLs (the app is
  // built with base "./") have nothing to resolve against. Point its base at the
  // main document's URL so cloned <link> hrefs and the fonts they pull in resolve
  // exactly as they do in the opener.
  const base = dst.createElement("base");
  base.href = src.baseURI;
  dst.head.appendChild(base);

  // Give the child a sane baseline: no default body margin, full-height root.
  const baseline = dst.createElement("style");
  baseline.textContent =
    "html,body{margin:0;height:100%}" +
    ".child-window-root,.panel-window-root{height:100vh;display:flex;flex-direction:column}";
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

// Keep the child window's Bootstrap theme in sync with the main window — both the
// initial value and any later OS light/dark switch.
export function mirrorTheme(src, dst) {
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
