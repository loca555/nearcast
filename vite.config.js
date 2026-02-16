import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "crypto", "stream", "vm"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  root: "frontend",
  build: {
    outDir: "../backend/public",
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    proxy: {
      "/api/": "http://localhost:4001",
    },
  },
});
