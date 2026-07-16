import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

const inContainer = fs.existsSync("/.dockerenv");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: inContainer
          ? "http://interface-api:3030"
          : "http://localhost:3030",
        changeOrigin: true,
        secure: false,
      },
      "/images": {
        target: inContainer
          ? "http://interface-api:3030"
          : "http://localhost:3030",
        changeOrigin: true,
        secure: false,
      },
      // The embedded terminal (page, xterm assets, /api/sessions, and the /ws
      // PTY WebSocket) is served by the backend under /terminal/.
      "/terminal": {
        target: inContainer
          ? "http://interface-api:3030"
          : "http://localhost:3030",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
