import {
  useCallback,
  useEffect,
  useContext,
  createContext,
  useMemo,
  useState,
} from "react";
import { toast } from "react-toastify";
import Spinner from "react-bootstrap/Spinner";
import { useNavigate, useParams } from "react-router";
import { loadLabspace, resolveLabUrl } from "./labspace/loader";
import { substituteVariables, slugify } from "./labspace/slugify";
import { scopedKey } from "./labspace/storage";
import { useCatalog } from "./context/CatalogContext";

// Server-free workshop context. Loads the labspace.yaml (and everything it
// references) as static assets, keeps variables in memory, and substitutes
// $$variables$$ into section markdown at render time.

const WorkshopContext = createContext();

const VARIABLES_KEY = "simspace:variables";

// Works out which lab to load and how to namespace its saved state, from the
// route's `labId` (catalog mode), the `?lab=` override, or the default single
// lab. Returns null while a catalog-mode lab is still waiting on the catalog.
//
//   labUrl:   labspace.yaml to fetch
//   labKey:   suffix for localStorage keys ("" = default lab, un-namespaced)
//   basePath: route prefix for section navigation ("" = single-lab routes)
function resolveTarget(labId, catalog) {
  if (labId) {
    if (catalog.status !== "ready") return null; // catalog still loading
    const lab = catalog.getLab(labId);
    if (!lab) return { error: `Lab "${labId}" was not found in the catalog.` };
    return { labUrl: lab.labspaceUrl, labKey: labId, basePath: `/labs/${labId}` };
  }
  // No catalog id in the route: honor a `?lab=` override, else the default lab.
  const override = new URLSearchParams(window.location.search).get("lab");
  return {
    labUrl: resolveLabUrl(),
    // Namespace an explicit override so switching labs can't cross-contaminate;
    // the plain default keeps the original, un-suffixed keys for compatibility.
    labKey: override ? slugify(override) : "",
    basePath: "",
  };
}

export const WorkshopContextProvider = ({ children, printMode = false }) => {
  const { labId, sectionId } = useParams();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const [workshop, setWorkshop] = useState(null);
  const [variables, setVariables] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(
    printMode ? null : sectionId,
  );

  const target = useMemo(
    () => resolveTarget(labId, catalog),
    [labId, catalog],
  );
  const labKey = target?.labKey || "";
  const basePath = target?.basePath || "";
  const variablesKey = scopedKey(VARIABLES_KEY, labKey);

  useEffect(() => {
    if (printMode) return;
    setActiveSectionId(sectionId);
  }, [sectionId, printMode]);

  const changeActiveSection = useCallback(
    (sectionId) => {
      navigate(`${basePath}/${sectionId}`);
    },
    [navigate, basePath],
  );

  // Load the labspace once the target lab is known. In catalog mode this waits
  // for the catalog to resolve the id; a full remount (keyed on labId) handles
  // switching between labs.
  useEffect(() => {
    if (!target?.labUrl) return;
    if (target.error) {
      toast.error(
        `${target.error} Check labs.json and the URL, then pick a lab.`,
        { toastId: "workshop-load-error", autoClose: false },
      );
      return;
    }
    let cancelled = false;
    loadLabspace(target.labUrl)
      .then((data) => {
        if (cancelled) return;
        setWorkshop({ ...data, labKey });
        const defaultVars = data.variables || {};
        try {
          const saved = localStorage.getItem(variablesKey);
          const parsed = saved ? JSON.parse(saved) : null;
          setVariables(parsed ? { ...defaultVars, ...parsed } : defaultVars);
        } catch {
          setVariables(defaultVars);
        }
        toast.dismiss("workshop-load-error");
      })
      .catch((error) => {
        console.error("Error loading labspace:", error);
        toast.error(
          `Failed to load the lab configuration: ${error.message}. Check that labspace.yaml is deployed alongside the app and refresh the page.`,
          {
            toastId: "workshop-load-error",
            autoClose: false,
            onClick: () => window.location.reload(),
          },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [target, labKey, variablesKey]);

  // Default to the first section once the workshop is loaded.
  useEffect(() => {
    if (printMode) return;
    setActiveSectionId((id) => id || workshop?.sections?.[0]?.id);
  }, [workshop, printMode]);

  // The active section with variables substituted into its markdown.
  const activeSection = useMemo(() => {
    if (!workshop || !activeSectionId) return null;
    const section = workshop.sections.find((s) => s.id === activeSectionId);
    if (!section) return {};
    return {
      id: section.id,
      title: section.title,
      baseUrl: section.baseUrl,
      content: substituteVariables(section.contentRaw, variables || {}),
    };
  }, [workshop, activeSectionId, variables]);

  useEffect(() => {
    if (!workshop) return;
    document.title = `${workshop.title}${activeSection?.title ? ` - ${activeSection.title}` : ""}`;
  }, [workshop, activeSection]);

  const setVariable = useCallback((key, value) => {
    setVariables((vars) => {
      const next = { ...vars, [key]: value ? value : undefined };
      try {
        localStorage.setItem(variablesKey, JSON.stringify(next));
      } catch { /* ignore storage errors */ }
      return next;
    });
  }, [variablesKey]);

  const resetVariables = useCallback(() => {
    try { localStorage.removeItem(variablesKey); } catch { /* ignore */ }
    setVariables(workshop?.variables || {});
  }, [workshop, variablesKey]);

  if (!workshop || (!printMode && !activeSection) || variables === null) {
    return (
      <div className="loading text-center mt-5 w-100">
        <Spinner />
        <p>Loading Labspace data...</p>
      </div>
    );
  }

  return (
    <WorkshopContext.Provider
      value={{
        workshop,
        activeSection,
        changeActiveSection,
        variables,
        setVariable,
        resetVariables,
      }}
    >
      {children}
    </WorkshopContext.Provider>
  );
};

export const useWorkshop = () => useContext(WorkshopContext).workshop;

export const useActiveSection = () => {
  const { activeSection, changeActiveSection } = useContext(WorkshopContext);
  return { activeSection, changeActiveSection };
};

export const useVariables = () => {
  const { variables, setVariable, resetVariables } = useContext(WorkshopContext);
  return { variables, setVariable, resetVariables };
};
