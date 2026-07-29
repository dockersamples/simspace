import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadCatalog } from "../labspace/catalog";

// Loads the optional lab catalog once and shares it app-wide. Both the landing
// page (to render the list) and the workshop loader (to resolve a lab id to its
// labspace.yaml) read from here.
//
// status: "loading" until the fetch settles, then "ready". When no catalog is
// deployed, labs is null and hasCatalog is false — callers fall back to the
// single lab in lab/.

const CatalogContext = createContext({
  status: "loading",
  labs: null,
  hasCatalog: false,
  getLab: () => null,
});

export function CatalogProvider({ children }) {
  const [labs, setLabs] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((result) => {
        if (cancelled) return;
        setLabs(result);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLabs(null);
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      labs,
      hasCatalog: Array.isArray(labs) && labs.length > 0,
      getLab: (id) => (labs || []).find((l) => l.id === id) || null,
    }),
    [status, labs],
  );

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export const useCatalog = () => useContext(CatalogContext);
