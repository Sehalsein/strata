import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../src/db";
import { apiCache as tmdbCache } from "../src/db/schema";
import { ApiCache } from "../src/catalog/apiCache";
import { Omdb } from "../src/catalog/omdb";
import { fakeTmdb, setUp, startTestServer, type TestServer } from "./helpers";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** An OMDb stand-in: Big Buck Bunny (movie) and Test Show (series, season 1). */
let omdbCalls = 0;
const fakeOmdb = async (url: URL) => {
  omdbCalls++;
  if (url.searchParams.get("apikey") !== "omdb-key") return json({ Response: "False", Error: "Invalid API key!" }, 401);
  const id = url.searchParams.get("i");
  const season = url.searchParams.get("Season");
  if (id === "tt0111161") return json({ Response: "True", imdbRating: "9.3" });
  if (id === "tt1254207" && !season) {
    return json({ Response: "True", imdbRating: "6.4", Ratings: [{ Source: "Internet Movie Database", Value: "6.4/10" }, { Source: "Rotten Tomatoes", Value: "88%" }, { Source: "Metacritic", Value: "70/100" }] });
  }
  if (id === "tt9000001" && !season) return json({ Response: "True", imdbRating: "8.1", Ratings: [{ Source: "Internet Movie Database", Value: "8.1/10" }] });
  if (id === "tt9000001" && season === "1") {
    return json({ Response: "True", Season: "1", Episodes: [{ Episode: "1", imdbRating: "7.9" }, { Episode: "2", imdbRating: "N/A" }] });
  }
  return json({ Response: "False", Error: "Incorrect IMDb ID." });
};

const fetchBoth = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  return url.hostname === "www.omdbapi.com" ? fakeOmdb(url) : fakeTmdb(input, init);
}) as typeof fetch;

test("OMDb: IMDb and Rotten Tomatoes ratings, episode ratings, cached", async () => {
  const db = await openDatabase("memory");
  omdbCalls = 0;
  const omdb = new Omdb(new ApiCache(db), () => "omdb-key", fetchBoth);
  expect(await omdb.ratings("tt1254207")).toEqual({ imdb: 6.4, rottenTomatoes: 88 });
  expect(await omdb.ratings("tt1254207")).toEqual({ imdb: 6.4, rottenTomatoes: 88 });
  expect(omdbCalls).toBe(1); // second answer from the cache
  expect(await omdb.ratings("tt9000001")).toEqual({ imdb: 8.1 });
  expect([...(await omdb.episodeRatings("tt9000001", 1))]).toEqual([[1, 7.9]]);
  expect((await omdb.episodeRatings("tt9000001", 0)).size).toBe(0); // no specials on OMDb
  expect(await omdb.ratings("tt0000000")).toBeNull();
  expect(await omdb.ratings("not-an-id")).toBeNull();
  expect(await omdb.testKey("omdb-key")).toBe(true);
  expect(await omdb.testKey("wrong")).toBe(false);
});

test("OMDb: no key means no ratings and no requests; a bad key isn't cached", async () => {
  const db = await openDatabase("memory");
  omdbCalls = 0;
  expect(await new Omdb(new ApiCache(db), () => undefined, fetchBoth).ratings("tt1254207")).toBeNull();
  expect(omdbCalls).toBe(0);
  expect(await new Omdb(new ApiCache(db), () => "wrong", fetchBoth).ratings("tt1254207")).toBeNull();
  expect((await db.select().from(tmdbCache)).filter((r) => !r.key.startsWith("omdb:usage:"))).toHaveLength(0);
});

test("OMDb: OMDb down keeps the last answer", async () => {
  const db = await openDatabase("memory");
  expect(await new Omdb(new ApiCache(db), () => "omdb-key", fetchBoth).ratings("tt1254207")).toEqual({ imdb: 6.4, rottenTomatoes: 88 });
  await db.update(tmdbCache).set({ fetchedAt: 0 });
  const down = new Omdb(new ApiCache(db), () => "omdb-key", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
  expect(await down.ratings("tt1254207")).toEqual({ imdb: 6.4, rottenTomatoes: 88 });
});

let server: TestServer;
let token: string;
beforeAll(async () => {
  server = await startTestServer(fetchBoth);
  token = (await setUp(server, "admin", "correct-horse")).token;
});
afterAll(() => {
  server.services.shutdown();
  rmSync(server.dataDir, { recursive: true, force: true });
});

test("detail pages carry ratings once an OMDb key is set, and nothing without one", async () => {
  const get = async (path: string) => (await (await server.request(path, { token })).json()) as Record<string, unknown>;

  expect((await get("/api/titles/movie/10378")).ratings).toBeNull();
  const before = (await get("/api/titles/show/9001/seasons/1")) as { episodes: { imdbRating: number | null }[] };
  expect(before.episodes.map((e) => e.imdbRating)).toEqual([null, null]);

  // Saving the key checks it with OMDb first.
  expect((await server.request("/api/admin/secrets/omdbApiKey", { method: "PUT", token, json: { value: "wrong" } })).status).toBe(400);
  expect((await server.request("/api/admin/secrets/omdbApiKey", { method: "PUT", token, json: { value: "omdb-key" } })).status).toBe(200);
  expect(((await get("/api/admin/settings")).secrets as Record<string, boolean>).omdbApiKey).toBe(true);

  expect((await get("/api/titles/movie/10378")).ratings).toEqual({ imdb: 6.4, rottenTomatoes: 88 });
  expect((await get("/api/titles/show/9001")).ratings).toEqual({ imdb: 8.1 });
  const after = (await get("/api/titles/show/9001/seasons/1")) as { episodes: { imdbRating: number | null }[] };
  expect(after.episodes.map((e) => e.imdbRating)).toEqual([7.9, null]);
});
