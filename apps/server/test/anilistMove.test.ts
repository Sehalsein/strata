import { expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { setUp, startTestServer } from "./helpers";
import { AnimeMove } from "../src/jobs/anilistMove";
import { AnimeIds, fileAnimeIdStore } from "../src/catalog/anime/ids";
import type { Anilist } from "../src/catalog/anime/anilist";
import type { Tmdb } from "../src/catalog/tmdb";
import { continueHidden, files, mediaItems, member, progress, watchlist } from "../src/db/schema";

// Frieren's two AniList seasons are TMDB S1 and S1 from episode 29; show 7000 is numbered
// absolutely in two AniList cours (the second from episode 13); show 8000's TMDB seasons
// are AniList entries of their own; Your Name. is a film. TMDB show 9001 isn't anime.
const RAW = [
  { type: "TV", anilist_id: 154587, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 } },
  { type: "TV", anilist_id: 182255, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 }, episode_offset: { tmdb: 28 } },
  { type: "TV", anilist_id: 501, themoviedb_id: { tv: 7000 } },
  { type: "TV", anilist_id: 502, themoviedb_id: { tv: 7000 }, episode_offset: { tmdb: 12 } },
  { type: "TV", anilist_id: 601, themoviedb_id: { tv: 8000 }, season: { tmdb: 1 } },
  { type: "TV", anilist_id: 602, themoviedb_id: { tv: 8000 }, season: { tmdb: 2 } },
  { type: "MOVIE", anilist_id: 21519, themoviedb_id: { movie: [372058] } },
];

test("anime moves from TMDB titles to AniList's, once, keeping the newer of clashing rows", async () => {
  const server = await startTestServer();
  const { household } = await setUp(server);
  const db = server.services.db;
  const org = household.organizationId;
  const [{ userId }] = (await db.select({ userId: member.userId }).from(member).where(eq(member.organizationId, org))) as [{ userId: string }];

  const ids = new AnimeIds(fileAnimeIdStore("/nonexistent"));
  ids.index(RAW);
  ids.ready = async () => {};
  const asked: number[] = [];
  const anilist = {
    title: async (id: number) => (asked.push(id), { id, format: id === 21519 ? "MOVIE" : "TV", seasonYear: 2020, title: { romaji: `Romaji ${id}`, english: id === 182255 ? "Frieren Season 2" : null }, coverImage: { extraLarge: `https://img.anili.st/${id}.jpg` }, bannerImage: null }),
  } as unknown as Anilist;
  const tmdb = { show: async (id: number) => ({ id, seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 14 }] }) } as unknown as Tmdb;

  const file = (ref: string, mediaType: "movie" | "episode", titleId: number, season: number | null = null, episode: number | null = null) =>
    ({ organizationId: org, provider: "local" as const, ref, name: ref, size: 1, mediaType, source: "tmdb" as const, titleId, season, episode, matchStatus: "matched" as const });
  await db.insert(files).values([
    file("/frieren-30.mkv", "episode", 209867, 1, 30),
    file("/frieren-03.mkv", "episode", 209867, 1, 3),
    file("/cours-s2e3.mkv", "episode", 7000, 2, 3),
    file("/your-name.mkv", "movie", 372058),
    file("/test-show.mkv", "episode", 9001, 1, 1),
  ]);
  const item = (source: "tmdb" | "anilist", type: "movie" | "show", titleId: number) => ({ organizationId: org, source, type, titleId, title: `${source} ${titleId}`, posterPath: "/p.jpg" });
  await db.insert(mediaItems).values([item("tmdb", "show", 209867), item("tmdb", "show", 7000), item("tmdb", "movie", 372058), item("tmdb", "show", 9001)]);
  const watched = (source: "tmdb" | "anilist", mediaType: "movie" | "episode", titleId: number, season: number, episode: number, positionMs: number, updatedAt: number) =>
    ({ userId, source, mediaType, titleId, season, episode, positionMs, durationMs: 1000, completed: false, updatedAt });
  await db.insert(progress).values([
    watched("tmdb", "episode", 209867, 1, 30, 100, 100),
    // Already watched under AniList, later: that one stays.
    watched("anilist", "episode", 182255, 1, 2, 999, 200),
    watched("tmdb", "episode", 209867, 1, 3, 300, 300),
    watched("tmdb", "episode", 7000, 2, 2, 400, 400),
    watched("tmdb", "movie", 372058, 0, 0, 500, 500),
    watched("tmdb", "episode", 9001, 1, 1, 600, 600),
  ]);
  await db.insert(watchlist).values([
    { userId, source: "tmdb", type: "show", titleId: 209867, addedAt: 10 },
    { userId, source: "tmdb", type: "show", titleId: 8000, addedAt: 11 },
    { userId, source: "tmdb", type: "movie", titleId: 372058, addedAt: 12 },
    { userId, source: "tmdb", type: "show", titleId: 9001, addedAt: 13 },
  ]);
  await db.insert(continueHidden).values([
    { userId, source: "tmdb", type: "show", titleId: 209867, hiddenAt: 50 },
    // Hidden under AniList before: the newer TMDB one replaces it.
    { userId, source: "anilist", type: "show", titleId: 182255, hiddenAt: 10 },
  ]);

  const move = () => new AnimeMove(db, org, household.library, { ids, anilist }, tmdb).run();
  expect(await move()).toEqual({ files: 4, progress: 4, watchlist: 3, hidden: 1 });

  const fileRows = await db.select().from(files).where(eq(files.organizationId, org));
  expect(Object.fromEntries(fileRows.map((f) => [f.ref, [f.source, f.titleId, f.season, f.episode]]))).toEqual({
    "/frieren-30.mkv": ["anilist", 182255, 1, 2],
    "/frieren-03.mkv": ["anilist", 154587, 1, 3],
    // TMDB S2E3 is absolute episode 13: the second cour's first.
    "/cours-s2e3.mkv": ["anilist", 502, 1, 1],
    "/your-name.mkv": ["anilist", 21519, null, null],
    "/test-show.mkv": ["tmdb", 9001, 1, 1],
  });
  const items = await db.select().from(mediaItems).where(eq(mediaItems.organizationId, org));
  expect(items.map((i) => `${i.source}:${i.type}:${i.titleId}`).sort()).toEqual(["anilist:movie:21519", "anilist:show:154587", "anilist:show:182255", "anilist:show:502", "tmdb:show:9001"]);
  expect(items.find((i) => i.titleId === 182255)).toMatchObject({ title: "Frieren Season 2", year: 2020, posterPath: "https://img.anili.st/182255.jpg", backdropPath: null });

  const progressRows = await db.select().from(progress).where(eq(progress.userId, userId));
  expect(progressRows.map((p) => `${p.source}:${p.mediaType}:${p.titleId}:${p.season}:${p.episode}:${p.positionMs}`).sort()).toEqual([
    "anilist:episode:154587:1:3:300",
    "anilist:episode:182255:1:2:999",
    "anilist:episode:501:1:12:400",
    "anilist:movie:21519:0:0:500",
    "tmdb:episode:9001:1:1:600",
  ]);
  // A show goes to the entry the person is furthest into, else its first season's.
  const listed = await db.select().from(watchlist).where(eq(watchlist.userId, userId));
  expect(listed.map((w) => `${w.source}:${w.type}:${w.titleId}`).sort()).toEqual(["anilist:movie:21519", "anilist:show:182255", "anilist:show:601", "tmdb:show:9001"]);
  const hidden = await db.select().from(continueHidden).where(eq(continueHidden.userId, userId));
  expect(hidden.map((h) => [h.source, h.titleId, h.hiddenAt])).toEqual([["anilist", 182255, 50]]);

  // Done once: the next run does nothing, and even without the marker nothing moves twice.
  asked.length = 0;
  expect(await move()).toMatchObject({ skipped: "already moved" });
  await db.execute(sql`DELETE FROM strata_meta WHERE key LIKE 'anilist-move:%'`);
  expect(await move()).toEqual({ files: 0, progress: 0, watchlist: 0, hidden: 0 });
  expect(asked).toEqual([]);
  expect((await db.select().from(files).where(and(eq(files.organizationId, org), eq(files.source, "anilist")))).length).toBe(4);

  // Without the anime id list, nothing is decided (and nothing recorded).
  await db.execute(sql`DELETE FROM strata_meta WHERE key LIKE 'anilist-move:%'`);
  const empty = new AnimeIds(fileAnimeIdStore("/nonexistent"));
  empty.ready = async () => {};
  expect(await new AnimeMove(db, org, household.library, { ids: empty, anilist }, tmdb).run()).toMatchObject({ skipped: "the anime id list isn't loaded yet" });
  server.services.shutdown();
});

test("the dashboard's Fix Match finds AniList titles and matches files to them", async () => {
  const { fakeTmdb } = await import("./helpers");
  const media = (id: number, format: string, extra: object = {}) => ({ id, format, episodes: 28, seasonYear: 2023, title: { romaji: `Romaji ${id}`, english: `English ${id}` }, synonyms: [], coverImage: { large: `https://img.anili.st/${id}.jpg` }, bannerImage: null, isAdult: false, ...extra });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname !== "graphql.anilist.co") return fakeTmdb(input, init);
    const { query, variables } = JSON.parse(String(init!.body)) as { query: string; variables: { id?: number } };
    if (query.includes("Page(perPage: 8)")) return Response.json({ data: { Page: { media: [media(154587, "TV"), media(666, "TV", { isAdult: true }), media(21519, "MOVIE", { episodes: 1 })] } } });
    return Response.json({ data: { Media: media(variables.id!, variables.id === 21519 ? "MOVIE" : "TV") } });
  }) as unknown as typeof fetch;
  const server = await startTestServer(fetchImpl);
  const { token, household } = await setUp(server);

  const search = (await (await server.request("/api/admin/anilist/search?q=frieren", { token })).json()) as { items: unknown[] };
  expect(search.items).toEqual([
    { ref: "anilist:show:154587", anilistId: 154587, title: "English 154587", year: 2023, format: "TV", posterUrl: "https://img.anili.st/154587.jpg", episodes: 28 },
    { ref: "anilist:movie:21519", anilistId: 21519, title: "English 21519", year: 2023, format: "MOVIE", posterUrl: "https://img.anili.st/21519.jpg", episodes: 1 },
  ]);

  const f = await household.library.upsert({ provider: "local", ref: "/x/frieren.mkv", name: "frieren.mkv", size: 1, parsed: { kind: "episode", title: "Frieren", episode: 3 } });
  const match = (json: object) => server.request(`/api/admin/files/${f.id}/match`, { method: "POST", token, json });
  expect((await match({ ref: "anilist:show:154587", season: 2, episode: 3 })).status).toBe(400);
  expect((await match({ ref: "anilist:show:154587" })).status).toBe(400);
  expect((await match({ ref: "anilist:movie:154587" })).status).toBe(400); // not a film on AniList
  expect((await match({ ref: "anilist:show:154587", episode: 3 })).status).toBe(200);
  expect(await household.library.get(f.id)).toMatchObject({ source: "anilist", titleId: 154587, mediaType: "episode", season: 1, episode: 3, matchStatus: "manual" });
  const list = (await (await server.request("/api/admin/files", { token })).json()) as { items: unknown[] };
  expect(list.items[0]).toMatchObject({ titleSource: "anilist", titleRef: "anilist:show:154587", title: "English 154587", tmdbId: null });
  // TMDB's way still works.
  expect((await match({ type: "show", tmdbId: 9001, season: 1, episode: 1 })).status).toBe(200);
  expect(await household.library.get(f.id)).toMatchObject({ source: "tmdb", titleId: 9001 });
  server.services.shutdown();
}, 30_000);
