// Router glue between this app and the runtime package.
//
// The runtime knows nothing about routes or the catalog: it takes a labspace
// URL, a storage key, and (optionally) the section to show. Everything that
// turns `#/labs/tour-of-docker/intro` into those three values lives here, which
// is the whole reason the same runtime can also be mounted by a site that routes
// completely differently.

import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { WorkshopContextProvider } from "@dockersamples/simspace-labspace";
import { useCatalog } from "../context/CatalogContext";
import { parseSlides } from "../deck/splitSlides";
import { LabNotFound } from "./LabNotFound";

// Works out which lab to load and how to namespace its saved state. Every lab
// comes from the catalog: the route's `labId` selects one, and at the root with
// exactly one lab that lab is entered directly (no id in the URL). Returns null
// while the catalog is still loading, or an { error } when there's nothing to
// load.
//
//   labUrl:   labspace.yaml to fetch
//   labKey:   suffix for localStorage keys (the lab id — keeps labs isolated)
//   basePath: route prefix for section navigation ("" for the single-lab root)
function resolveTarget(labId, catalog) {
  if (catalog.status !== "ready") return null; // catalog still loading
  const labs = catalog.labs || [];
  const lab = labId
    ? catalog.getLab(labId)
    : labs.length === 1
      ? labs[0]
      : null;
  if (!lab) {
    return {
      error: labId
        ? `Lab "${labId}" was not found in the catalog.`
        : "No lab found. Add one under labs/<id>/ and regenerate the catalog (npm run validate-lab).",
    };
  }
  return {
    labUrl: lab.labspaceUrl,
    labKey: lab.id,
    basePath: labId ? `/labs/${lab.id}` : "",
  };
}

/**
 * Mounts the runtime's workshop provider for the lab the current route selects.
 * Children get the loaded labspace exactly as they did when this app owned the
 * provider outright.
 */
export function LabRoute({ children, printMode = false }) {
  const { labId, sectionId } = useParams();
  const catalog = useCatalog();
  const navigate = useNavigate();

  const target = useMemo(() => resolveTarget(labId, catalog), [labId, catalog]);
  const basePath = target?.basePath || "";

  const changeSection = useCallback(
    (nextId) => navigate(`${basePath}/${nextId}`),
    [navigate, basePath],
  );

  // Decks are this app's feature, so the runtime is handed the slide splitter
  // rather than importing it.
  const loaderOptions = useMemo(() => ({ parseSlides }), []);

  if (!target) return null; // catalog still loading
  if (target.error) return <LabNotFound message={target.error} />;

  return (
    <WorkshopContextProvider
      // Remount the whole provider tree when the lab changes so its simulator,
      // variables, and terminals reinitialize cleanly instead of leaking state
      // from the previously loaded lab.
      key={target.labKey}
      labspaceUrl={target.labUrl}
      labKey={target.labKey}
      section={printMode ? undefined : sectionId}
      onSectionChange={changeSection}
      loaderOptions={loaderOptions}
      printMode={printMode}
      // This app IS the page, so it owns the tab title. An embedded runtime
      // leaves its host's title alone.
      documentTitle
    >
      {children}
    </WorkshopContextProvider>
  );
}
