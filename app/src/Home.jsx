import Spinner from "react-bootstrap/Spinner";
import AppRoute from "./AppRoute";
import { Catalog } from "./components/Catalog/Catalog";
import { useCatalog } from "./context/CatalogContext";

// The landing route. Decides between the two modes once the optional catalog
// has resolved:
//   - A catalog is deployed (and no `?lab=` override is forcing a single lab):
//     show the lab-selection page.
//   - Otherwise: render the single lab directly, with no lab id in the URL —
//     identical to the original single-lab experience.
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

  const hasOverride = new URLSearchParams(window.location.search).has("lab");
  if (catalog.hasCatalog && !hasOverride) {
    return <Catalog labs={catalog.labs} />;
  }

  // Single-lab fallback: AppRoute has no `labId` param here, so WorkshopContext
  // loads `lab/labspace.yaml` and uses un-namespaced storage keys.
  return <AppRoute />;
}
