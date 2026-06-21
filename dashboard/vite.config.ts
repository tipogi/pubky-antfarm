import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The antfarm dashboard API runs on 127.0.0.1:6400 (config: dashboard_addr).
// Proxy /api there so the SPA and the SSE stream share an origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6400",
        changeOrigin: true,
      },
    },
  },
});
