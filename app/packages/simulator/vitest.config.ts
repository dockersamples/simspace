import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The engine is pure and runs in the default `node` environment — no DOM, which
// is itself part of the contract (see test/engine/purity.test.ts). The React
// component tests opt into jsdom with a per-file
// `// @vitest-environment jsdom` docblock, so a DOM is only ever created for the
// handful of files that genuinely need one.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
