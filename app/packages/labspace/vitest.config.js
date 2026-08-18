import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workspaceSource } from "../../scripts/workspace-source.mjs";

// The runtime package's own suite, alongside the simulator package's — `npm test`
// at the app root runs all three.
//
// Same rule as the app's config: the React UI is verified by running it, so this
// covers the pure pieces where a subtle bug wouldn't show on screen — the remark
// plugins that decide which code fences get a Run button, above all.
export default defineConfig({
  plugins: [react()],
  // This package imports the simulator by name, so it needs the same
  // source resolution the app uses — see scripts/workspace-source.mjs.
  resolve: { alias: workspaceSource },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
