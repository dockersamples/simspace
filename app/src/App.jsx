import "./App.scss";
import { HashRouter, Route, Routes } from "react-router";
import AppRoute from "./AppRoute";
import ExportRoute from "./ExportRoute";
import Home from "./Home";
import { CatalogProvider } from "./context/CatalogContext";

// HashRouter keeps routing entirely client-side (routes live in the URL hash),
// so deep links and reloads work on any static host — including GitHub Pages —
// without a server-side rewrite or 404 fallback.
//
// Every lab comes from the catalog (labs.json, generated from labs/*/). Home
// decides at `#/`: one lab is entered directly (clean URL, no id), several show
// the selection page. The routes:
//   - `#/:sectionId`, `#/export` — the single-lab case (no id in the URL).
//   - `#/labs/:labId/:sectionId?`, `#/labs/:labId/export` — a chosen catalog lab.
function App() {
  return (
    <HashRouter>
      <CatalogProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="export" element={<ExportRoute />} />
          <Route path="labs/:labId/export" element={<ExportRoute />} />
          <Route path="labs/:labId/:sectionId?" element={<AppRoute />} />
          <Route path=":sectionId" element={<AppRoute />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </CatalogProvider>
    </HashRouter>
  );
}

export default App;
