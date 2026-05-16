import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number.parseInt(process.env.WEB_PORT ?? "5173", 10),
    proxy: {
      "/jf": {
        target: process.env.VITE_JELLYFIN_TARGET ?? "http://localhost:8096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/jf/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
