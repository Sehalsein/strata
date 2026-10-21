import type { MiddlewareHandler } from "hono";

const MIN_BYTES = 1024;

/**
 * Gzips JSON answers for clients that accept it: catalog JSON shrinks about 3x (the
 * Anime page: 82 KB to 27 KB). Never the stream routes, which must reach Bun untouched
 * for byte ranges and HLS files. (Bun.gzipSync, not hono/compress: this Bun has no
 * CompressionStream.)
 */
export function gzipJson(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/stream/") || !/\bgzip\b/.test(c.req.header("accept-encoding") ?? "")) return;
    const res = c.res;
    if (!res.body || res.headers.has("content-encoding") || !res.headers.get("content-type")?.includes("application/json")) return;
    const body = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    headers.append("Vary", "Accept-Encoding");
    if (body.byteLength < MIN_BYTES) {
      c.res = new Response(body, { status: res.status, headers });
      return;
    }
    const zipped = Bun.gzipSync(body);
    headers.set("Content-Encoding", "gzip");
    headers.set("Content-Length", String(zipped.byteLength));
    c.res = new Response(zipped, { status: res.status, headers });
  };
}
