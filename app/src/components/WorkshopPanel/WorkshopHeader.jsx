import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "react-toastify";
import { useActiveSection, useWorkshop } from "../../WorkshopContext";
import { useCatalog } from "../../context/CatalogContext";
import { useTerminal } from "../../context/TerminalContext";
import { usePanelWindow } from "../../context/PanelWindowContext";

// Must match the cache names in public/sw.js.
const APP_CACHE = "labspace-app";
const LAB_CACHE = "labspace-lab";

// Sticky branded header for the instructions pane. Shows the lab identity and a
// segmented progress bar so the learner always knows where they are.
//
// The Docker logo hosts a hidden right-click menu with a "Reset lab" action.
// It's deliberately out of the way — resetting re-seeds the whole shared
// machine, so it's mainly a tool for authors/testers rather than learners.
export function WorkshopHeader() {
  const workshop = useWorkshop();
  const { title, sections } = workshop;
  const { activeSection } = useActiveSection();
  const terminal = useTerminal();
  const panelWindow = usePanelWindow();
  // Only offer "back to all labs" when there's actually a catalog to return to
  // (two or more labs). A single lab is entered directly, with no landing page.
  const { labs } = useCatalog();
  const multiLab = (labs?.length ?? 0) > 1;
  const [menu, setMenu] = useState(null);
  const [isOfflineCached, setIsOfflineCached] = useState(false);

  // On mount, detect whether the lab is already in the offline cache and, if
  // so, check whether the network version of labspace.yaml has changed.
  useEffect(() => {
    if (import.meta.env.DEV || !("caches" in window)) return;
    const labUrl = workshop.offlineUrls?.[0];
    if (!labUrl) return;

    caches.match(labUrl, { cacheName: LAB_CACHE }).then((cached) => {
      if (!cached) return;
      setIsOfflineCached(true);

      // Compare the cached copy against a fresh network fetch. If they differ
      // the lab has been updated and the user should re-cache.
      fetch(labUrl, { cache: "no-store" })
        .then((fresh) => {
          if (!fresh.ok) return null;
          return Promise.all([cached.text(), fresh.text()]);
        })
        .then((texts) => {
          if (!texts || texts[0] === texts[1]) return;
          toast.warn(
            <span>
              Lab content has been updated.{" "}
              <button
                type="button"
                className="btn btn-sm btn-warning ms-1"
                onClick={() =>
                  Promise.all([
                    caches.delete(APP_CACHE),
                    caches.delete(LAB_CACHE),
                  ]).then(() => window.location.reload())
                }
              >
                Update now
              </button>
            </span>,
            { autoClose: false, toastId: "lab-updated" },
          );
        })
        .catch(() => {
          // Offline — nothing to compare against, which is expected.
        });
    });
  }, [workshop]);

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

  const togglePanelWindow = useCallback(() => {
    closeMenu();
    panelWindow?.toggle();
  }, [panelWindow, closeMenu]);

  const makeAvailableOffline = useCallback(async () => {
    closeMenu();

    if (import.meta.env.DEV) {
      toast.info(
        "Offline mode is disabled in development. Build the app to test it.",
        { autoClose: 4000 },
      );
      return;
    }

    if (!("serviceWorker" in navigator)) {
      toast.error("Offline mode is not supported in this browser.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const sw = registration.active;
    if (!sw) {
      toast.error("Could not prepare offline cache. Try reloading the page.");
      return;
    }

    const toastId = toast.loading("Saving lab for offline use...");

    const urls = [
      // App shell
      window.location.origin + window.location.pathname,
      // The catalog (so the landing page works offline too)
      new URL("labs.json", document.baseURI).toString(),
      // Lab content files loaded at startup
      ...(workshop.offlineUrls || []),
    ];

    // Extract image URLs referenced in section markdown so they're cached
    // even if the learner hasn't scrolled to those sections yet.
    for (const section of workshop.sections) {
      if (!section.contentRaw) continue;
      const imgPattern = /!\[[^\]]*\]\(([^)\s]+)/g;
      let match;
      while ((match = imgPattern.exec(section.contentRaw)) !== null) {
        const src = match[1];
        if (!src.startsWith("http") && !src.startsWith("data:")) {
          try {
            urls.push(new URL(src, section.baseUrl).toString());
          } catch {
            // skip malformed URLs
          }
        }
      }
    }

    const onMessage = (event) => {
      if (event.data?.type !== "CACHE_COMPLETE") return;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      setIsOfflineCached(true);
      toast.update(toastId, {
        render: "Lab saved! It will work without an internet connection.",
        type: "success",
        isLoading: false,
        autoClose: 5000,
      });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    sw.postMessage({ type: "CACHE_ALL", urls });
  }, [closeMenu, workshop]);

  const disableOfflineMode = useCallback(async () => {
    closeMenu();
    await Promise.all([caches.delete(APP_CACHE), caches.delete(LAB_CACHE)]);
    setIsOfflineCached(false);
    toast.dismiss("lab-updated");
    toast.info(
      "Offline mode disabled. Refresh to load the latest lab content.",
      {
        autoClose: 5000,
      },
    );
  }, [closeMenu]);

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
          {multiLab && (
            <Link
              to="/"
              className="workshop-back-link"
              title="Back to all labs"
              aria-label="Back to all labs"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
          )}
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
            {"serviceWorker" in navigator && (
              <button
                type="button"
                className="workshop-context-menu-item"
                role="menuitem"
                onClick={
                  isOfflineCached ? disableOfflineMode : makeAvailableOffline
                }
              >
                <span className="material-symbols-outlined">
                  {isOfflineCached ? "cloud_off" : "download_for_offline"}
                </span>
                {isOfflineCached
                  ? "Disable offline mode"
                  : "Make available offline"}
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
}
