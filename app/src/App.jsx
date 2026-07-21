import "./App.scss";
import { HashRouter, Route, Routes } from "react-router";
import AppRoute from "./AppRoute";
import ExportRoute from "./ExportRoute";

// HashRouter keeps routing entirely client-side (routes live in the URL hash),
// so deep links and reloads work on any static host — including GitHub Pages —
// without a server-side rewrite or 404 fallback.
function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="export" element={<ExportRoute />} />
        <Route path=":sectionId?" element={<AppRoute />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
