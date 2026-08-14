import "./App.scss";
import Spinner from "react-bootstrap/Spinner";
import { Link, useParams } from "react-router";
import { useCatalog } from "./context/CatalogContext";
import { useAppConfig } from "./context/AppConfigContext";
import { resolveTracking } from "@dockersamples/simspace-labspace/loader";
import { InsightsDashboard } from "./components/Insights/InsightsDashboard";

// Instructor-only insights route. Resolves the lab (from the catalog) and its
// public tracking coordinates, then hands off to the dashboard, which gates the
// cumulative data behind the backend's instructor token.
//
//   #/insights                 → the sole lab (single-lab deploys)
//   #/labs/:labId/insights     → a chosen catalog lab
export default function InsightsRoute() {
  const { labId } = useParams();
  const catalog = useCatalog();
  const appConfig = useAppConfig();

  if (catalog.status === "loading" || appConfig.status === "loading") {
    return (
      <div className="loading text-center mt-5 w-100">
        <Spinner />
        <p>Loading…</p>
      </div>
    );
  }

  const labs = catalog.labs || [];
  const lab = labId
    ? catalog.getLab(labId)
    : labs.length === 1
      ? labs[0]
      : null;

  if (!lab) {
    return (
      <div className="loading text-center mt-5 w-100">
        <h1 className="h4">Lab not found</h1>
        <p className="text-secondary">
          No lab matched this URL. <Link to="/">Back to all labs</Link>.
        </p>
      </div>
    );
  }

  const tracking = resolveTracking(appConfig.tracking, lab.tracking, lab.id);
  if (!tracking?.endpoint) {
    return (
      <div className="loading text-center mt-5 w-100">
        <h1 className="h4">Insights not available</h1>
        <p className="text-secondary">
          “{lab.title}” has no tracking backend configured, so there is nothing
          to report. <Link to="/">Back to all labs</Link>.
        </p>
      </div>
    );
  }

  return <InsightsDashboard lab={{ ...lab, tracking }} />;
}
