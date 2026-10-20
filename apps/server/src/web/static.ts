import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { Context } from "hono";
import { embeddedFiles } from "./embedded";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  json: "application/json",
  webmanifest: "application/manifest+json",
};

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>Strata</title>
<body style="font-family:system-ui;background:#0b0b0c;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div><h1>Strata server is running</h1><p>The dashboard isn't bundled in this build. Run <code>bun run build</code> in apps/server/web, or start with <code>--web-dir</code>.</p></div>`;

/** Serves the dashboard SPA from disk (dev) or from files embedded in the binary. */
export function webHandler(webDir?: string) {
  const lookup = (path: string): string | undefined => {
    if (webDir) {
      const full = normalize(join(webDir, path));
      if (!full.startsWith(webDir)) return undefined;
      return existsSync(full) ? full : undefined;
    }
    return embeddedFiles[path];
  };

  return (c: Context) => {
    const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "") || "index.html";
    const asset = lookup(rel);
    if (asset && !rel.endsWith("/")) {
      const ext = rel.split(".").pop() ?? "";
      const immutable = rel.startsWith("assets/");
      return new Response(Bun.file(asset), {
        headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
    // Unknown paths are client-side routes.
    const index = lookup("index.html");
    if (!index) return c.html(PLACEHOLDER);
    return new Response(Bun.file(index), { headers: { "Content-Type": TYPES.html!, "Cache-Control": "no-cache" } });
  };
}
