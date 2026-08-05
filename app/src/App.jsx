import "./App.scss";
import { HashRouter, Route, Routes } from "react-router";
import EntryRoute from "./EntryRoute";
import ExportRoute from "./ExportRoute";
import InsightsRoute from "./InsightsRoute";
import Home from "./Home";
import { AppConfigProvider } from "./context/AppConfigContext";
import { CatalogProvider } from "./context/CatalogContext";

// HashRouter keeps routing entirely client-side (routes live in the URL hash),
// so deep links and reloads work on any static host — including GitHub Pages —
// without a server-side rewrite or 404 fallback.
//
// Every lab comes from the catalog (labs.json, generated from labs/*/). Home
// decides at `#/`: one lab is entered directly (clean URL, no id), several show
// the selection page. The routes:
//   - `#/:sectionId`, `#/export` — the single-entry case (no id in the URL).
//   - `#/labs/:labId/:sectionId?`, `#/labs/:labId/export` — a chosen entry.
//
// Both kinds of entry (labs and slide decks) share the `#/labs/…` shape;
// EntryRoute reads the entry's `kind` from the catalog and picks the view.
function App() {
  return (
    <HashRouter>
      <AppConfigProvider>
        <CatalogProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="export" element={<ExportRoute />} />
            <Route path="insights" element={<InsightsRoute />} />
            <Route path="labs/:labId/export" element={<ExportRoute />} />
            <Route path="labs/:labId/insights" element={<InsightsRoute />} />
            <Route path="labs/:labId/:sectionId?" element={<EntryRoute />} />
            <Route path=":sectionId" element={<EntryRoute />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </CatalogProvider>
      </AppConfigProvider>
    </HashRouter>
  );
}

export default App;
