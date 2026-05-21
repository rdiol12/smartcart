import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    // Same-origin proxying for `npm run dev`, mirroring the nginx setup in prod.
    // Server listens on host:8000 (see docker-compose.yml and server/.env).
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
