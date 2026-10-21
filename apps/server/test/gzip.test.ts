import { expect, test } from "bun:test";
import { Hono } from "hono";
import { gzipJson } from "../src/api/gzip";

test("JSON is gzipped for clients that accept it; small answers, other types and streams aren't", async () => {
  const big = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Title ${i}` })) };
  const app = new Hono();
  app.use("/api/*", gzipJson());
  app.get("/api/big", (c) => c.json(big));
  app.get("/api/small", (c) => c.json({ ok: true }));
  app.get("/api/stream/x/file", (c) => c.json(big));
  app.get("/api/text", (c) => c.text("x".repeat(5000)));
  const get = (path: string, gzip = true) => app.request(path, { headers: gzip ? { "Accept-Encoding": "gzip, deflate, br" } : {} });

  const zipped = await get("/api/big");
  expect(zipped.headers.get("content-encoding")).toBe("gzip");
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await zipped.arrayBuffer()))))).toEqual(big);
  expect((await get("/api/big", false)).headers.get("content-encoding")).toBeNull();
  expect((await get("/api/small")).headers.get("content-encoding")).toBeNull();
  expect((await get("/api/stream/x/file")).headers.get("content-encoding")).toBeNull();
  expect((await get("/api/text")).headers.get("content-encoding")).toBeNull();
});
