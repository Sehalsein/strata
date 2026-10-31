import { expect, test } from "bun:test";
import { openDatabase } from "../src/db";
import { apiCache as tmdbCache } from "../src/db/schema";
import { ApiCache } from "../src/catalog/apiCache";
import { Tmdb } from "../src/catalog/tmdb";

test("TMDB: stale answers come back at once and refresh behind; failures keep the old copy", async () => {
  const db = await openDatabase("memory");
  let calls = 0;
  let fail = false;
  const tmdb = new Tmdb(new ApiCache(db), () => "key", () => "en-US", (async () => {
    calls++;
    if (fail) return new Response("down", { status: 503 });
    return Response.json({ page: 1, results: [{ id: calls }], total_pages: 1 });
  }) as unknown as typeof fetch);

  expect((await tmdb.trending("movie")).results[0]!.id).toBe(1);
  expect((await tmdb.trending("movie")).results[0]!.id).toBe(1); // fresh: no request
  expect(calls).toBe(1);

  // Age the row past its TTL (and drop the in-memory copy by using a new client).
  await db.update(tmdbCache).set({ fetchedAt: 0 });
  const again = new Tmdb(new ApiCache(db), () => "key", () => "en-US", (async () => {
    calls++;
    if (fail) return new Response("down", { status: 503 });
    return Response.json({ page: 1, results: [{ id: calls }], total_pages: 1 });
  }) as unknown as typeof fetch);
  expect((await again.trending("movie")).results[0]!.id).toBe(1); // stale, instantly
  await Bun.sleep(10);
  expect((await again.trending("movie")).results[0]!.id).toBe(2); // refreshed behind

  fail = true;
  await db.update(tmdbCache).set({ fetchedAt: 0 });
  const third = new Tmdb(new ApiCache(db), () => "key", () => "en-US", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
  expect((await third.trending("movie")).results[0]!.id).toBe(2); // TMDB down: the old copy
  await Bun.sleep(10);
  expect((await third.trending("movie")).results[0]!.id).toBe(2);
});
