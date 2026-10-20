import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../context";

const CONTENT_TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

const typeOf = (name: string) => CONTENT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * Stream URLs carry an unguessable session id instead of an auth header, because
 * AVPlayer (and HLS segment fetches) can't reliably attach headers.
 */
export const streamRoutes = new Hono<Env>()
  .get("/stream/:sid/file", async (c) => {
    const session = c.var.services.sessions.get(c.req.param("sid"));
    if (!session || session.plan.mode !== "direct") throw new HTTPException(404, { message: "No such stream" });
    if (session.inputKind === "url") {
      const key = c.var.services.settings.getSecret("torboxApiKey");
      // TorBox CDN links are normally key-free and safe to hand out; if one ever embeds
      // the account key, proxy the bytes rather than leak it to the client.
      if (!key || !session.input.includes(key)) return c.redirect(session.input, 302);
      return proxyRange(session.input, c.req.header("range"));
    }
    return serveRange(session.input, c.req.header("range"));
  })

  // Extraction can take a while (the whole file is read); after a short wait the client
  // gets 202 and retries while it finishes in the background.
  .get("/stream/:sid/subtitles/:track{[sx]\\d+\\.vtt}", async (c) => {
    const services = c.var.services;
    const session = services.sessions.get(c.req.param("sid"));
    const id = c.req.param("track").replace(/\.vtt$/, "");
    const track = session?.subtitles.find((t) => t.id === id);
    if (!session || !track) throw new HTTPException(404, { message: "No such subtitle track" });
    if (!track.text) throw new HTTPException(415, { message: "Bitmap subtitles can't be converted to WebVTT" });
    const job = services.subtitles.vtt(session.fileId, session.input, track);
    const path = await Promise.race([job, Bun.sleep(25_000).then(() => null)]);
    if (!path) {
      job.catch(() => {});
      return c.json({ status: "extracting" }, 202, { "Retry-After": "5" });
    }
    return new Response(Bun.file(path), { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=3600" } });
  })

  .get("/stream/:sid/:name{(?:stream\\.m3u8|init\\.mp4|seg\\d{5}\\.m4s)}", async (c) => {
    const services = c.var.services;
    const session = services.sessions.get(c.req.param("sid"));
    if (!session || !session.dir) throw new HTTPException(404, { message: "No such stream" });
    const name = c.req.param("name");
    const path = await services.sessions.waitForFile(session, name);
    if (!path) throw new HTTPException(session.error ? 502 : 504, { message: session.error ?? "Stream not ready" });
    return new Response(Bun.file(path), {
      headers: { "Content-Type": typeOf(name), "Cache-Control": name.endsWith(".m3u8") ? "no-cache" : "private, max-age=3600" },
    });
  });

async function proxyRange(url: string, range: string | undefined): Promise<Response> {
  const upstream = await fetch(url, { headers: range ? { Range: range } : {} });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export function serveRange(path: string, range: string | undefined): Response {
  const file = Bun.file(path);
  const size = file.size;
  const headers: Record<string, string> = { "Accept-Ranges": "bytes", "Content-Type": typeOf(path) };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response(file, { headers: { ...headers, "Content-Length": String(size) } });
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  // Must reach Bun.serve untouched: re-wrapping (e.g. by header-setting middleware)
  // reads `.body`, which for a sliced BunFile streams the whole file.
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
