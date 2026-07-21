import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is fully static: it fetches its labspace.yaml (and the files it
// references) at runtime as static assets, so there is no dev proxy or backend.
// `base: "./"` emits relative asset URLs so the build works when served from a
// subpath (e.g. a GitHub Pages project site at /<repo>/).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
