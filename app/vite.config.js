import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { catalogJson } from "./scripts/catalog.mjs";

// The app is fully static: it fetches its labs.json + labspace.yaml (and the
// files they reference) at runtime as static assets, so there is no dev proxy or
// backend. `base: "./"` emits relative asset URLs so the build works when served
// from a subpath (e.g. a GitHub Pages project site at /<repo>/).

const LABS_DIR = "public/labs";

// Generates labs.json from public/labs/*/labspace.yaml — so the catalog is never
// hand-written and can't drift. Serves it fresh on every dev request; emits it
// into the build output. See scripts/catalog.mjs.
function catalogPlugin() {
  return {
    name: "labspace-catalog",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path !== "/labs.json") return next();
        try {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(catalogJson(LABS_DIR));
        } catch (e) {
          res.statusCode = 500;
          res.end(`/* catalog generation failed: ${e.message} */`);
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "labs.json",
        source: catalogJson(LABS_DIR),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), catalogPlugin()],
});
