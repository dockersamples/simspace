import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workspaceSource } from "./scripts/workspace-source.mjs";

// Tests for the APP's own logic. The simulator package has its own suite and its
// own config (app/packages/simulator/vitest.config.ts); `npm test` runs both.
//
// The app is largely React glue that's verified by running it, so this covers the
// pure pieces where a subtle bug wouldn't be obvious on screen — slide splitting
// above all, where a mis-split fence silently corrupts every slide after it.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceSource },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
