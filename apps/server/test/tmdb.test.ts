import { expect, test } from "bun:test";
import { openDatabase } from "../src/db";
import { apiCache as tmdbCache } from "../src/db/schema";
import { ApiCache } from "../src/catalog/apiCache";
import { Tmdb, logoUrl } from "../src/catalog/tmdb";

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

test("TMDB logos: the server's language first, then English, then textless; PNGs only", () => {
  const png = (path: string, lang: string | null, votes = 5) => ({ file_path: `/${path}.png`, iso_639_1: lang, vote_average: votes });
  const url = (p: string) => `https://image.tmdb.org/t/p/w500/${p}.png`;
  // English beats a textless one; the better rated English one wins.
  expect(logoUrl({ logos: [png("none", null, 9), png("en-low", "en", 1), png("en-high", "en", 8)] }, "en-US")).toBe(url("en-high"));
  // The server's own language comes first.
  expect(logoUrl({ logos: [png("en", "en", 9), png("de", "de", 1)] }, "de-DE")).toBe(url("de"));
  // No English or local logo: a textless one still shows the name.
  expect(logoUrl({ logos: [png("none", null)] }, "en-US")).toBe(url("none"));
  // Only other languages, SVGs, or nothing: no logo, and the apps show the name.
  expect(logoUrl({ logos: [png("ja", "ja")] }, "en-US")).toBeNull();
  expect(logoUrl({ logos: [{ file_path: "/a.svg", iso_639_1: "en" }] }, "en-US")).toBeNull();
  expect(logoUrl(undefined, "en-US")).toBeNull();
});

test("TMDB details ask for logos in the server's language, English and textless", async () => {
  const db = await openDatabase("memory");
  const seen: string[] = [];
  const tmdb = new Tmdb(new ApiCache(db), () => "key", () => "fr-FR", (async (input: string | URL) => {
    seen.push(String(input));
    return Response.json({ id: 1, title: "X", genres: [], seasons: [] });
  }) as unknown as typeof fetch);
  await tmdb.movie(1);
  await tmdb.show(2);
  for (const u of seen) {
    const params = new URL(u).searchParams;
    expect(params.get("append_to_response")).toContain("images");
    expect(params.get("include_image_language")).toBe("fr,en,null");
  }
});
