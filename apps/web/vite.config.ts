import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, resolve(__dirname, "../.."), ""),
    ...loadEnv(mode, __dirname, ""),
    ...process.env,
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      allowedHosts: true,
      port: Number.parseInt(env.WEB_PORT ?? "5173", 10),
      proxy: {
        "/jf": {
          target: env.VITE_JELLYFIN_TARGET ?? "http://localhost:8096",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jf/, ""),
        },
      },
    },
    preview: {
      host: true,
      allowedHosts: true,
      port: Number.parseInt(env.WEB_PORT ?? "5173", 10),
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
