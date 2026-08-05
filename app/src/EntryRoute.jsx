import Spinner from "react-bootstrap/Spinner";
import { useParams } from "react-router";
import AppRoute from "./AppRoute";
import DeckRoute from "./DeckRoute";
import { useCatalog } from "./context/CatalogContext";

// Dispatches one catalog entry to the view that knows how to run it: a `lab`
// opens the instructions + terminal split (AppRoute), a `slides` entry opens the
// deck (DeckRoute).
//
// The URL stays `#/labs/<id>/…` for BOTH kinds. That's deliberate: the id is
// also the localStorage namespace and pulse's `labId`, and `?catalog=` and every
// deployed deep link resolve against this shape — so introducing `#/decks/<id>`
// would fork all of that to describe something only the landing page cares
// about. The kind lives in the catalog, not the URL.
//
// Keeping the branch HERE, rather than teaching WorkshopPanel a second mode, is
// what stops the app shell from growing a per-kind conditional in every
// component below it.
export default function EntryRoute() {
  const { labId } = useParams();
  const catalog = useCatalog();

  // Wait for the catalog before choosing a view — picking the wrong one and
  // swapping it out would remount the whole provider tree (and its simulator).
  if (catalog.status === "loading") {
    return (
      <div className="loading text-center mt-5 w-100">
        <Spinner />
        <p>Loading…</p>
      </div>
    );
  }

  // With no id in the URL we're in the single-entry case, where the sole
  // catalog entry is entered directly. An unknown id falls through to AppRoute,
  // which surfaces the "not found in the catalog" error.
  const entry = labId
    ? catalog.getLab(labId)
    : catalog.labs?.length === 1
      ? catalog.labs[0]
      : null;

  return entry?.kind === "slides" ? <DeckRoute /> : <AppRoute />;
}
