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
// Two shapes coexist:
//   - Single-lab (no labs.json): `#/`, `#/:sectionId`, `#/export` — no lab id.
//   - Catalog (labs.json present): `#/` lists labs; a lab lives under
//     `#/labs/:labId/:sectionId?` with `#/labs/:labId/export`.
// Home picks between the two once the catalog has (or hasn't) loaded.
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
