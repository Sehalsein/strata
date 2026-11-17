import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer, defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The knowledge base wears the landing site's Liquid Glass (its glass utilities, mark and
// buttons come from apps/landing/src), on the dashboard's tokens: "@" is the dashboard's
// src, as it is for the landing site, and shared libraries resolve to one copy.
const dashboard = decodeURIComponent(new URL("../server/web/src", import.meta.url).pathname);

/** Where the site is published; the Markdown copies link here. */
const DOCS_URL = "https://docs.strata.sehalsein.com";

type LlmsModule = typeof import("./llms");
type ArticlesModule = typeof import("./src/articles");

async function llmsFiles(server: ViteDevServer, site: string) {
  const { llmsFiles } = (await server.ssrLoadModule("/llms.ts")) as LlmsModule;
  const { SECTIONS } = (await server.ssrLoadModule("/src/articles/index.ts")) as ArticlesModule;
  return llmsFiles(SECTIONS, site);
}

/**
 * /llms.txt, /llms-full.txt and a .md copy of every guide (see llms.ts): served on the fly
 * in dev, written into dist at build.
 */
function llms(): Plugin {
  let outDir = "dist";
  let building = false;
  return {
    name: "strata-llms",
    configResolved(config) {
      outDir = config.build.outDir;
      building = config.command === "build" && !config.server.middlewareMode;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0]!.slice(1);
        if (!/^(llms(-full)?\.txt|.+\.md)$/.test(path)) return next();
        try {
          const file = (await llmsFiles(server, `http://${req.headers.host}`))[path];
          if (file === undefined) return next();
          res.setHeader("Content-Type", `${path.endsWith(".md") ? "text/markdown" : "text/plain"}; charset=utf-8`);
          res.end(file);
        } catch (e) {
          next(e);
        }
      });
    },
    async closeBundle() {
      if (!building) return;
      const server = await createServer({ configFile: false, root: import.meta.dirname, resolve: { alias: { "@": dashboard } }, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
      try {
        const files = await llmsFiles(server, DOCS_URL);
        for (const [path, text] of Object.entries(files)) {
          const out = join(outDir, path);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, text);
        }
        this.info?.(`llms: ${Object.keys(files).length} files`);
      } finally {
        await server.close();
      }
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), llms()],
  resolve: {
    alias: { "@": dashboard },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "radix-ui", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority"],
  },
  build: { outDir: "dist", assetsDir: "assets", emptyOutDir: true, target: "es2022" },
  server: { port: 5180 },
  preview: { port: 5180 },
});
