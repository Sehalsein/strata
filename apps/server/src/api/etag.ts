import type { MiddlewareHandler } from "hono";

/**
 * ETags for the JSON answers apps may keep (those with a `max-age`): an app asking again
 * with the tag it has gets "304 Not Modified" and no body when nothing changed, so a page
 * that's the same costs a few bytes instead of its whole JSON. Only JSON with a `max-age`:
 * media and files go out untouched, and `no-store` answers are never kept anyway.
 */
export function etagJson(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.req.method !== "GET" || c.res.status !== 200) return;
    const res = c.res;
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    if (!res.body || !/max-age=\d+/.test(cacheControl) || !res.headers.get("Content-Type")?.includes("application/json")) return;
    const body = await res.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", body));
    const tag = `W/"${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
    const headers = new Headers(res.headers);
    headers.set("ETag", tag);
    if (matches(c.req.header("If-None-Match"), tag)) {
      // The body's headers go; how long it may be kept again stays.
      headers.delete("Content-Type");
      headers.delete("Content-Length");
      c.res = new Response(null, { status: 304, headers });
      return;
    }
    c.res = new Response(body, { status: 200, headers });
  };
}

function matches(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === tag.replace(/^W\//, "") || t.trim() === "*");
}
