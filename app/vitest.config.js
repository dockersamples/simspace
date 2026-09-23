import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workspaceSource } from "./scripts/workspace-source.mjs";

// Tests for the APP's own logic. The simulator package has its own suite and its
// own config (app/packages/simulator/vitest.config.ts); `npm test` runs both.
//
// The app is largely React glue that's verified by running it, so this covers the
// pure pieces where a subtle bug wouldn't be obvious on screen — slide splitting
// above all, where a mis-split fence silently corrupts every slide after it.
//
// `scripts/` is in scope for the same reason: sim-editor's patcher REWRITES an
// author's hand-formatted simulator.yaml, so a subtle bug there silently
// corrupts a lab rather than showing up on screen.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      ...workspaceSource,
      // sim-editor's browser UI imports YAML from a route its own server
      // serves out of node_modules; in a test there is no server, so point the
      // same specifier at the package.
      "/vendor/yaml/index.js": "yaml",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}", "scripts/**/*.test.{js,ts}"],
  },
});
