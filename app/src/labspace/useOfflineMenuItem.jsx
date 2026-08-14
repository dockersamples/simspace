// The "Make available offline" action for this app's header menu.
//
// Service-worker caching is a property of THIS app — it has a `public/sw.js`, it
// is served from its own origin, and it knows its own app-shell URL. A host
// embedding the runtime has its own caching story (a CDN, usually) and no
// service worker of ours to talk to, which is why this lives here and is handed
// to the runtime as one more menu item rather than being built into the header.

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useWorkshop } from "@dockersamples/simspace-labspace";

// Must match the cache names in public/sw.js.
const APP_CACHE = "labspace-app";
const LAB_CACHE = "labspace-lab";

export function useOfflineMenuItem() {
  const workshop = useWorkshop();
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

  const makeAvailableOffline = useCallback(async () => {
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
  }, [workshop]);

  const disableOfflineMode = useCallback(async () => {
    await Promise.all([caches.delete(APP_CACHE), caches.delete(LAB_CACHE)]);
    setIsOfflineCached(false);
    toast.dismiss("lab-updated");
    toast.info(
      "Offline mode disabled. Refresh to load the latest lab content.",
      {
        autoClose: 5000,
      },
    );
  }, []);

  if (!("serviceWorker" in navigator)) return null;

  return {
    id: "offline",
    icon: isOfflineCached ? "cloud_off" : "download_for_offline",
    label: isOfflineCached ? "Disable offline mode" : "Make available offline",
    onSelect: isOfflineCached ? disableOfflineMode : makeAvailableOffline,
  };
}
