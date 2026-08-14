import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tests for the APP's own logic. The simulator package has its own suite and its
// own config (app/packages/simulator/vitest.config.ts); `npm test` runs both.
//
// The app is largely React glue that's verified by running it, so this covers the
// pure pieces where a subtle bug wouldn't be obvious on screen — slide splitting
// above all, where a mis-split fence silently corrupts every slide after it.
export default defineConfig({
  plugins: [react()],
  // Same reason as vite.config.js: tests run against source, never a stale dist.
  resolve: {
    alias: {
      "@dockersamples/simspace-labspace/loader": resolve(
        __dirname,
        "packages/labspace/src/loader.js",
      ),
      "@dockersamples/simspace-labspace": resolve(
        __dirname,
        "packages/labspace/src/index.js",
      ),
      // Must precede the "/react" entry below: aliases match by prefix, so the
      // broader key would rewrite this into ".../react/index.ts/styles.css".
      "@dockersamples/simspace-simulator/react/styles.css": resolve(
        __dirname,
        "packages/simulator/src/react/MockTerminal.css",
      ),
      "@dockersamples/simspace-simulator/react": resolve(
        __dirname,
        "packages/simulator/src/react/index.ts",
      ),
      "@dockersamples/simspace-simulator": resolve(
        __dirname,
        "packages/simulator/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
