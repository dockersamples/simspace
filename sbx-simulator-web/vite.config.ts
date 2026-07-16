import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev/demo config. `npm run dev` serves the demo app in src/demo.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
  },
});
