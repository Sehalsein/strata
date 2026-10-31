import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": decodeURIComponent(new URL("./src", import.meta.url).pathname) },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    proxy: {
      // STRATA_API points the dev dashboard at another server (e.g. a demo instance).
      "/api": process.env.STRATA_API ?? "http://localhost:8420",
    },
  },
});
