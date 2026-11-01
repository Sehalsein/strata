import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { runtime } from "#runtime";
import { rowsOf } from "../src/db";
import { migrations } from "../src/db/migrations";
import { playSessions, user } from "../src/db/schema";
import { formatRef, parseRef, tmdbRef } from "../src/catalog/ref";
import { setUp, startTestServer, type TestServer } from "./helpers";

describe("title refs", () => {
  test("round trip", () => {
    expect(formatRef(tmdbRef("show", 1399))).toBe("tmdb:show:1399");
    expect(parseRef("tmdb:show:1399")).toEqual({ source: "tmdb", type: "show", id: 1399 });
    expect(parseRef("anilist:movie:5114")).toEqual({ source: "anilist", type: "movie", id: 5114 });
    expect(parseRef(formatRef({ source: "anilist", type: "show", id: 52991 }))).toEqual({ source: "anilist", type: "show", id: 52991 });
  });

  test("anything else isn't one", () => {
    for (const text of [
      "",
      "imdb:movie:1", // unknown source
      "TMDB:movie:1",
      "tmdb:tv:1", // unknown type
      "tmdb:episode:1",
      "tmdb:movie:0", // ids start at 1
      "tmdb:movie:-1",
      "tmdb:movie:01",
      "tmdb:movie:1.5",
      "tmdb:movie:2147483648", // above Postgres' INTEGER
      "tmdb:movie:99999999999",
      "tmdb:movie:1:extra",
      "tmdb:movie",
      " tmdb:movie:1",
    ]) {
      expect(parseRef(text)).toBeNull();
    }
    expect(parseRef("tmdb:movie:2147483647")).toEqual({ source: "tmdb", type: "movie", id: 2147483647 });
  });
});

test("migration 6 keeps everything there was, as TMDB's", async () => {
  // Brought up to v5 by hand, with rows in the old shape, then on to v6.
  const client = await runtime.openClient("memory");
  const db = client.db;
  const run = async (script: string) => {
    for (const statement of script.split(";").map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(statement));
  };
  try {
    for (const script of migrations.slice(0, 5)) await run(script);
    await run(`
      INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES ('u1', 'Ann', 'ann@example.com', now(), now());
      INSERT INTO organization (id, name, slug, created_at) VALUES ('o1', 'Home', 'home', now());
      INSERT INTO files (organization_id, provider, ref, name, size, media_type, tmdb_id, season, episode, match_status, added_at, updated_at)
        VALUES ('o1', 'local', '/tv/a.mkv', 'a.mkv', 1, 'episode', 1399, 1, 2, 'matched', 1, 1);
      INSERT INTO media_items (organization_id, type, tmdb_id, title, added_at) VALUES ('o1', 'show', 1399, 'Show', 1);
      INSERT INTO progress (user_id, media_type, tmdb_id, season, episode, position_ms, duration_ms, updated_at) VALUES ('u1', 'episode', 1399, 1, 2, 5000, 60000, 1);
      INSERT INTO continue_hidden (user_id, type, tmdb_id, hidden_at) VALUES ('u1', 'show', 1399, 1);
      INSERT INTO watchlist (user_id, type, tmdb_id, added_at) VALUES ('u1', 'movie', 603, 1);
    `);
    await run(migrations[5]!);
    const one = async (table: string) => rowsOf(await db.execute(sql.raw(`SELECT source, title_id FROM ${table}`)));
    for (const [table, id] of [["files", 1399], ["media_items", 1399], ["progress", 1399], ["continue_hidden", 1399], ["watchlist", 603]] as const) {
      expect(await one(table)).toEqual([{ source: "tmdb", title_id: id }]);
    }
    // The same id from another source is another title.
    await run(`INSERT INTO watchlist (user_id, source, type, title_id, added_at) VALUES ('u1', 'anilist', 'movie', 603, 2)`);
    expect(await one("watchlist")).toHaveLength(2);
  } finally {
    await client.close();
  }
});

describe("the API by ref", () => {
  let server: TestServer;
  let token: string;
  const json = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json()) as any;
  };
  beforeAll(async () => {
    server = await startTestServer();
    ({ token } = await setUp(server));
  });
  afterAll(() => server.services.shutdown());

  test("title pages: the same as by type and id, 404 for a source without pages yet, 400 for a bad ref", async () => {
    const byRef = await json(await server.request("/api/titles/tmdb:movie:10378", { token }));
    expect(byRef).toEqual(await json(await server.request("/api/titles/movie/10378", { token })));
    expect(byRef).toMatchObject({ ref: "tmdb:movie:10378", tmdbId: 10378 });
    expect(await json(await server.request("/api/titles/tmdb:show:9001", { token }))).toMatchObject({ ref: "tmdb:show:9001", tmdbId: 9001 });
    expect(await json(await server.request("/api/titles/tmdb:show:9001/seasons/1", { token }))).toEqual(
      await json(await server.request("/api/titles/show/9001/seasons/1", { token })),
    );
    expect((await server.request("/api/titles/tmdb:show:9001", { token })).headers.get("cache-control")).toBe(
      (await server.request("/api/titles/show/9001", { token })).headers.get("cache-control"),
    );

    const anilist = await server.request("/api/titles/anilist:show:1", { token });
    expect(anilist.status).toBe(404);
    expect(await anilist.text()).toContain("Not available yet");
    expect((await server.request("/api/titles/anilist:show:1/seasons/1", { token })).status).toBe(404);
    expect((await server.request("/api/titles/tmdb:movie:10378/seasons/1", { token })).status).toBe(404);
    for (const bad of ["tmdb:movie:0", "imdb:movie:1", "tmdb:tv:1", "nonsense"]) {
      expect((await server.request(`/api/titles/${bad}`, { token })).status).toBe(400);
    }
  });

  test("progress by ref", async () => {
    const res = await json(await server.request("/api/progress", { method: "POST", token, json: { ref: "tmdb:movie:10378", positionMs: 120_000, durationMs: 600_000 } }));
    expect(res).toEqual({ positionMs: 120_000, durationMs: 600_000, completed: false });
    expect((await json(await server.request("/api/titles/movie/10378", { token }))).progress).toMatchObject({ positionMs: 120_000 });
    // Episodes by their show's ref.
    await json(await server.request("/api/progress", { method: "POST", token, json: { ref: "tmdb:show:9001", season: 1, episode: 1, positionMs: 90_000, durationMs: 1_800_000 } }));
    const season = await json(await server.request("/api/titles/show/9001/seasons/1", { token }));
    expect(season.episodes.find((e: any) => e.episode === 1).progress).toMatchObject({ positionMs: 90_000 });

    const post = (body: object) => server.request("/api/progress", { method: "POST", token, json: { positionMs: 1, durationMs: 2, ...body } });
    expect((await post({ ref: "tmdb:show:9001" })).status).toBe(400); // an episode needs its numbers
    expect((await post({ ref: "tmdb:movie:-4" })).status).toBe(400);
    expect((await post({ ref: "tmdb:movie" })).status).toBe(400);
    expect((await post({})).status).toBe(400);

    // Continue Watching carries refs; off it by ref.
    const shelf = async () => (await json(await server.request("/api/home/profile", { token }))).shelves.find((s: any) => s.id === "continue");
    expect((await shelf()).items.map((i: any) => [i.ref, i.tmdbId])).toEqual([["tmdb:show:9001", 9001], ["tmdb:movie:10378", 10378]]);
    await json(await server.request("/api/continue/tmdb:show:9001", { method: "DELETE", token }));
    expect((await shelf()).items.map((i: any) => i.ref)).toEqual(["tmdb:movie:10378"]);
    await json(await server.request("/api/continue/movie/10378", { method: "DELETE", token }));
    expect(await shelf()).toBeUndefined();
    expect((await server.request("/api/continue/tmdb:movie:x", { method: "DELETE", token })).status).toBe(400);
  });

  test("My List by ref, and old apps' bodies alike", async () => {
    const put = (body: object) => server.request("/api/watchlist", { method: "PUT", token, json: body });
    await json(await put({ ref: "tmdb:movie:10378", on: true }));
    await json(await put({ type: "show", tmdbId: 9001, on: true }));
    const items = (await json(await server.request("/api/watchlist", { token }))).items;
    expect(items.map((i: any) => [i.ref, i.type, i.tmdbId]).sort()).toEqual([["tmdb:movie:10378", "movie", 10378], ["tmdb:show:9001", "show", 9001]]);
    expect((await json(await server.request("/api/titles/tmdb:movie:10378", { token }))).inWatchlist).toBe(true);

    await json(await put({ ref: "tmdb:show:9001", on: false }));
    expect((await json(await server.request("/api/watchlist", { token }))).items.map((i: any) => i.ref)).toEqual(["tmdb:movie:10378"]);
    expect((await put({ ref: "anilist:sh0w:1", on: true })).status).toBe(400);
    expect((await put({ on: true })).status).toBe(400);
  });

  test("sources by ref", async () => {
    const byRef = await json(await server.request("/api/sources?ref=tmdb:movie:10378", { token }));
    expect(byRef).toEqual(await json(await server.request("/api/sources?mediaType=movie&tmdbId=10378", { token })));
    expect((await server.request("/api/sources?ref=tmdb:show:9001", { token })).status).toBe(400); // no episode
    expect((await server.request("/api/sources?ref=bad", { token })).status).toBe(400);
    // Nothing from AniList in the library yet.
    expect(await json(await server.request("/api/sources?ref=anilist:movie:1&discover=1", { token }))).toEqual({ items: [] });
  });

  test("plays: kept by source and titleId; ones from before sources are TMDB's", async () => {
    const h = await server.household();
    const [owner] = await server.services.db.select({ id: user.id }).from(user);
    const now = Date.now();
    const row = { organizationId: h.organizationId, userId: owner!.id, fileId: 1, planJson: JSON.stringify({ mode: "direct", reasons: [] }), input: "https://x.test/f", createdAt: now, lastAccessAt: now };
    await server.services.db.insert(playSessions).values([
      { ...row, id: "old", targetJson: JSON.stringify({ mediaType: "episode", tmdbId: 9001, season: 1, episode: 2 }) },
      { ...row, id: "new", targetJson: JSON.stringify({ source: "anilist", mediaType: "movie", titleId: 5 }) },
    ]);
    const plays = await server.services.sessions.list();
    expect(plays.find((s) => s.id === "old")!.target).toEqual({ source: "tmdb", mediaType: "episode", titleId: 9001, season: 1, episode: 2 });
    expect(plays.find((s) => s.id === "new")!.target).toMatchObject({ source: "anilist", mediaType: "movie", titleId: 5 });
    // The admin pages read target.tmdbId: TMDB's id, or null for other sources.
    const admin = (await json(await server.request("/api/admin/sessions", { token }))).items;
    expect(admin.find((s: any) => s.id === "old").target).toMatchObject({ source: "tmdb", ref: "tmdb:show:9001", tmdbId: 9001 });
    expect(admin.find((s: any) => s.id === "new").target).toMatchObject({ source: "anilist", ref: "anilist:movie:5", tmdbId: null });
    await server.services.db.delete(playSessions);
  });

  test("cards carry their ref", async () => {
    const { items } = await json(await server.request("/api/browse/movie/trending", { token }));
    expect(items.length).toBeGreaterThan(0);
    for (const card of items) expect(card.ref).toBe(`tmdb:${card.type}:${card.tmdbId}`);
    const { shelves } = await json(await server.request("/api/home/catalog", { token }));
    for (const card of shelves.flatMap((s: any) => s.items)) expect(card.ref).toBe(`tmdb:${card.type}:${card.tmdbId}`);
  });
});
