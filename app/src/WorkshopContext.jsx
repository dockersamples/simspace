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
import { loadLabspace } from "./labspace/loader";
import { substituteVariables } from "./labspace/slugify";

// Server-free workshop context. Loads the labspace.yaml (and everything it
// references) as static assets, keeps variables in memory, and substitutes
// $$variables$$ into section markdown at render time.

const WorkshopContext = createContext();

const VARIABLES_KEY = "simspace:variables";

export const WorkshopContextProvider = ({ children, printMode = false }) => {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [workshop, setWorkshop] = useState(null);
  const [variables, setVariables] = useState(null);
  const [activeSectionId, setActiveSectionId] = useState(
    printMode ? null : sectionId,
  );

  useEffect(() => {
    if (printMode) return;
    setActiveSectionId(sectionId);
  }, [sectionId, printMode]);

  const changeActiveSection = useCallback(
    (sectionId) => {
      navigate(`/${sectionId}`);
    },
    [navigate],
  );

  // Load the labspace once on mount.
  useEffect(() => {
    let cancelled = false;
    loadLabspace()
      .then((data) => {
        if (cancelled) return;
        setWorkshop(data);
        const defaultVars = data.variables || {};
        try {
          const saved = localStorage.getItem(VARIABLES_KEY);
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
  }, []);

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
        localStorage.setItem(VARIABLES_KEY, JSON.stringify(next));
      } catch { /* ignore storage errors */ }
      return next;
    });
  }, []);

  const resetVariables = useCallback(() => {
    try { localStorage.removeItem(VARIABLES_KEY); } catch { /* ignore */ }
    setVariables(workshop?.variables || {});
  }, [workshop]);

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
