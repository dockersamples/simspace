import Spinner from "react-bootstrap/Spinner";
import AppRoute from "./AppRoute";
import { Catalog } from "./components/Catalog/Catalog";
import { useCatalog } from "./context/CatalogContext";

// The landing route. Every lab comes from the catalog (labs.json, generated from
// labs/*/labspace.yaml). Once it resolves:
//   - no labs        → an error (nothing to serve)
//   - exactly one    → enter it directly, with no lab id in the URL
//   - two or more    → show the lab-selection page
export default function Home() {
  const catalog = useCatalog();

  if (catalog.status === "loading") {
    return (
      <div className="loading text-center mt-5 w-100">
        <Spinner />
        <p>Loading labs...</p>
      </div>
    );
  }

  if (!catalog.hasCatalog) {
    return (
      <div className="loading text-center mt-5 w-100">
        <h1 className="h4">No labs found</h1>
        <p className="text-secondary">
          Add a lab under <code>labs/&lt;id&gt;/</code> (with a{" "}
          <code>labspace.yaml</code>) and regenerate the catalog with{" "}
          <code>npm run validate-lab</code>.
        </p>
      </div>
    );
  }

  // A single lab needs no landing page — go straight in. AppRoute has no `labId`
  // param here, so WorkshopContext loads the sole catalog entry and keeps the URL
  // clean (`#/`, `#/<section>`).
  if (catalog.labs.length === 1) return <AppRoute />;

  return <Catalog labs={catalog.labs} />;
}
