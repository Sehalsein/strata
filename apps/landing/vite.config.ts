import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The landing site reuses the dashboard's design (its tokens, brand mark, poster wall,
// theme toggle and privacy page): "@" is the dashboard's src, and the libraries both use
// resolve to one copy, this app's.
const dashboard = decodeURIComponent(new URL("../server/web/src", import.meta.url).pathname);

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": dashboard },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "radix-ui", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority"],
  },
  build: { outDir: "dist", assetsDir: "assets", emptyOutDir: true, target: "es2022" },
  // The site passes /api through to the server (see deploy/landing).
  server: { proxy: { "/api": process.env.STRATA_API ?? "http://localhost:8420" } },
  preview: { proxy: { "/api": process.env.STRATA_API ?? "http://localhost:8420" } },
});
