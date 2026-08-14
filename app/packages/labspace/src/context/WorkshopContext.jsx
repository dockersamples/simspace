import {
  useCallback,
  useEffect,
  useContext,
  createContext,
  useMemo,
  useState,
} from "react";
import { loadLabspace } from "../labspace/loader";
import { substituteVariables } from "../labspace/slugify";
import { scopedKey } from "../labspace/storage";
import { LoadingState, ErrorState } from "../components/LoadState";

// Server-free workshop context. Loads the labspace.yaml (and everything it
// references) as static assets, keeps variables in memory, and substitutes
// $$variables$$ into section markdown at render time.
//
// WHICH lab to load is the host's business, not this provider's: it takes a
// `labspaceUrl` (or an already-resolved `config`) and a `labKey` to namespace
// saved state. In the lab app those come from the catalog and the route; in an
// embedding site they come from whatever that site routes on. Nothing here
// reads the URL, a router, or a catalog.

const WorkshopContext = createContext();

const VARIABLES_KEY = "simspace:variables";

/**
 * Provides one loaded labspace to the runtime beneath it.
 *
 * Content — exactly one of:
 *   labspaceUrl  URL of a labspace.yaml to fetch and parse at mount.
 *   config       An already-resolved config (the shape loadLabspace returns).
 *                A host that loads at BUILD time passes this, so there is no
 *                fetch, no loading state, and the instructions can be rendered
 *                into the served HTML.
 *
 * Identity and storage:
 *   labKey       Namespaces this lab's saved variables, engine snapshot,
 *                transcripts, and progress, so several labs on one origin stay
 *                isolated. Omit only when a page hosts exactly one lab forever.
 *
 * Section navigation — uncontrolled by default (the provider keeps the active
 * section in state). Pass both to control it from a router instead:
 *   section          the active section id
 *   onSectionChange  called with the next id when the learner navigates
 *
 * Other seams:
 *   loaderOptions  forwarded to loadLabspace ({ fetchText, parseSlides }).
 *   documentTitle  set document.title from the lab + section. Default false:
 *                  an embedded runtime must not retitle its host's page.
 *   onError        called with the load error, in addition to rendering it.
 */
export const WorkshopContextProvider = ({
  children,
  labspaceUrl,
  config,
  labKey = "",
  section,
  onSectionChange,
  loaderOptions,
  printMode = false,
  documentTitle = false,
  onError,
  className,
}) => {
  const [workshop, setWorkshop] = useState(
    config ? { ...config, labKey } : null,
  );
  const [loadError, setLoadError] = useState(null);
  const [variables, setVariables] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(null);

  // A host that passes `onSectionChange` is driving navigation — typically a
  // router keeping the section in the URL. Its value is then authoritative,
  // INCLUDING when it has none: at `/labs/my-lab` (no section segment) the lab
  // must open on the first section, not on whatever section was showing before.
  // Mirroring the absence is what makes that work; treating a missing host value
  // as "keep the current one" silently strands the reader mid-lab.
  const controlled = Boolean(onSectionChange);
  const variablesKey = scopedKey(VARIABLES_KEY, labKey);

  const changeActiveSection = useCallback(
    (nextId) => {
      // Update straight away, then let the host confirm through `section`.
      setActiveSectionId(nextId);
      onSectionChange?.(nextId);
    },
    [onSectionChange],
  );

  useEffect(() => {
    if (!controlled || printMode) return;
    setActiveSectionId(section ?? null);
  }, [controlled, section, printMode]);

  // Seed variables from a build-time config without a fetch.
  useEffect(() => {
    if (!config) return;
    setWorkshop({ ...config, labKey });
    setVariables(readVariables(variablesKey, config.variables || {}));
  }, [config, labKey, variablesKey]);

  // Fetch the labspace when the host passed a URL rather than a config.
  useEffect(() => {
    if (config || !labspaceUrl) return undefined;
    let cancelled = false;
    setLoadError(null);
    loadLabspace(labspaceUrl, loaderOptions)
      .then((data) => {
        if (cancelled) return;
        setWorkshop({ ...data, labKey });
        setVariables(readVariables(variablesKey, data.variables || {}));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading labspace:", error);
        setLoadError(error);
        onError?.(error);
      });
    return () => {
      cancelled = true;
    };
    // `loaderOptions` and `onError` are host-owned and often inline literals;
    // depending on them would refetch the lab on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, labspaceUrl, labKey, variablesKey]);

  // Open on the first section whenever nothing has named one — on load, and
  // again if the host clears its value. Runs after the mirror above, so the
  // functional update sees the cleared state.
  useEffect(() => {
    if (printMode) return;
    setActiveSectionId((id) => id || workshop?.sections?.[0]?.id);
  }, [workshop, printMode, section]);

  // The active section with variables substituted into its markdown.
  const activeSection = useMemo(() => {
    if (!workshop || !activeSectionId) return null;
    const found = workshop.sections.find((s) => s.id === activeSectionId);
    if (!found) return {};
    return {
      id: found.id,
      title: found.title,
      baseUrl: found.baseUrl,
      content: substituteVariables(found.contentRaw, variables || {}),
    };
  }, [workshop, activeSectionId, variables]);

  useEffect(() => {
    if (!documentTitle || !workshop) return;
    document.title = `${workshop.title}${activeSection?.title ? ` - ${activeSection.title}` : ""}`;
  }, [documentTitle, workshop, activeSection]);

  const setVariable = useCallback(
    (key, value) => {
      setVariables((vars) => {
        const next = { ...vars, [key]: value ? value : undefined };
        try {
          localStorage.setItem(variablesKey, JSON.stringify(next));
        } catch {
          /* ignore storage errors */
        }
        return next;
      });
    },
    [variablesKey],
  );

  const resetVariables = useCallback(() => {
    try {
      localStorage.removeItem(variablesKey);
    } catch {
      /* ignore */
    }
    setVariables(workshop?.variables || {});
  }, [workshop, variablesKey]);

  const value = useMemo(
    () => ({
      workshop,
      activeSection,
      changeActiveSection,
      variables,
      setVariable,
      resetVariables,
    }),
    [
      workshop,
      activeSection,
      changeActiveSection,
      variables,
      setVariable,
      resetVariables,
    ],
  );

  // Rendered inline rather than raised as a toast: the runtime may be one panel
  // of someone else's page, where a corner notification is both out of place and
  // easy to miss.
  if (loadError) {
    return <ErrorState error={loadError} className={className} />;
  }

  if (!workshop || (!printMode && !activeSection) || variables === null) {
    return <LoadingState className={className} />;
  }

  return (
    <WorkshopContext.Provider value={value}>
      {children}
    </WorkshopContext.Provider>
  );
};

function readVariables(variablesKey, defaults) {
  try {
    const saved = localStorage.getItem(variablesKey);
    const parsed = saved ? JSON.parse(saved) : null;
    return parsed ? { ...defaults, ...parsed } : defaults;
  } catch {
    return defaults;
  }
}

export const useWorkshop = () => useContext(WorkshopContext).workshop;

export const useActiveSection = () => {
  const { activeSection, changeActiveSection } = useContext(WorkshopContext);
  return { activeSection, changeActiveSection };
};

export const useVariables = () => {
  const { variables, setVariable, resetVariables } =
    useContext(WorkshopContext);
  return { variables, setVariable, resetVariables };
};
