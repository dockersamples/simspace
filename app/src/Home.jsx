import Spinner from "react-bootstrap/Spinner";
import EntryRoute from "./EntryRoute";
import { Catalog } from "./components/Catalog/Catalog";
import { useCatalog } from "./context/CatalogContext";

// The landing route. Every entry comes from the catalog (labs.json, generated
// from labs/*/labspace.yaml). Once it resolves:
//   - nothing        → an error (nothing to serve)
//   - exactly one    → enter it directly, with no id in the URL
//   - two or more    → show the selection page
//
// A workshop that ships a slide deck AND its lab lands in the third case, which
// is the point: two cards, ordered by `catalog.order`.
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

  // A single entry needs no landing page — go straight in. EntryRoute has no
  // `labId` param here, so it resolves the sole catalog entry, and the loaders
  // below keep the URL clean (`#/`, `#/<section>`).
  if (catalog.labs.length === 1) return <EntryRoute />;

  return <Catalog labs={catalog.labs} />;
}
