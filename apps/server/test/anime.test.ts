import { describe, expect, test } from "bun:test";
import { AnimeIds, kitsuEpisode } from "../src/catalog/anime/ids";
import { relevant, type Release } from "../src/sources/discovery";
import { AnimeMatcher, pickAnime, resolveEpisode } from "../src/catalog/anime/match";
import type { Anilist } from "../src/catalog/anime/anilist";
import type { Tmdb } from "../src/catalog/tmdb";
import { parseFileName } from "../src/media/parse";

// Real entries from Fribb/anime-lists (trimmed).
const RAW = [
  { type: "TV", anilist_id: 154587, kitsu_id: 46474, themoviedb_id: { tv: 209867 }, season: { tvdb: 1, tmdb: 1 } }, // Frieren
  { type: "TV", anilist_id: 182255, kitsu_id: 49240, themoviedb_id: { tv: 209867 }, season: { tvdb: 2, tmdb: 1 }, episode_offset: { tmdb: 28 } }, // Frieren S2
  { type: "TV", anilist_id: 21, kitsu_id: 12, themoviedb_id: { tv: 37854 } }, // One Piece: absolute
  { type: "MOVIE", anilist_id: 21519, kitsu_id: 11614, themoviedb_id: { movie: [372058] } }, // Your Name.
];

const ids = () => {
  const map = new AnimeIds("/nonexistent");
  map.index(RAW);
  return map;
};

describe("anime episode numbering", () => {
  const frieren = [{ season: 1, episodes: 38 }];
  const onePiece = [
    { season: 1, episodes: 61 },
    { season: 2, episodes: 16 },
    { season: 22, episodes: 1100 }, // stand-in for the long tail of arcs
  ];

  test("an episode within the matched entry keeps its TMDB season", () => {
    const map = ids();
    expect(resolveEpisode(map.show(209867), map.anilist(154587)!, undefined, 12, frieren)).toEqual({ season: 1, episode: 12 });
  });

  test('"S2 - 03" uses the S2 entry TMDB season and offset', () => {
    const map = ids();
    expect(resolveEpisode(map.show(209867), map.anilist(154587)!, 2, 3, frieren)).toEqual({ season: 1, episode: 31 });
  });

  test("absolute numbers walk TMDB's seasons", () => {
    const map = ids();
    expect(resolveEpisode(map.show(37854), map.anilist(21)!, undefined, 70, onePiece)).toEqual({ season: 2, episode: 9 });
    expect(resolveEpisode(map.show(37854), map.anilist(21)!, undefined, 1122, onePiece)).toEqual({ season: 22, episode: 1045 });
  });
});

describe("picking the AniList result", () => {
  const results = [
    { id: 182255, format: "TV", title: { romaji: "Sousou no Frieren 2nd Season", english: "Frieren: Beyond Journey's End Season 2" } },
    { id: 154587, format: "TV", title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" }, synonyms: ["Frieren at the Funeral"] },
  ];

  test("matches the romaji title exactly, ignoring the sequel", () => {
    expect(pickAnime(results, parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))?.id).toBe(154587);
  });

  test("matches the English title too", () => {
    expect(pickAnime(results, { kind: "episode", title: "Frieren Beyond Journey's End", episode: 3, anime: true })?.id).toBe(154587);
  });

  test("nothing close enough gives no match", () => {
    expect(pickAnime(results, { kind: "episode", title: "Chainsaw Man", episode: 1, anime: true })).toBeNull();
  });
});

describe("AnimeMatcher", () => {
  test("a fansub file becomes the TMDB show, season and episode", async () => {
    const anilist = { search: async () => [{ id: 182255, format: "TV", title: { romaji: "Sousou no Frieren 2nd Season" } }, { id: 154587, format: "TV", title: { romaji: "Sousou no Frieren" } }] } as unknown as Anilist;
    const tmdb = {
      show: async () => ({ id: 209867, name: "Frieren: Beyond Journey's End", first_air_date: "2023-09-29", genres: [{ id: 16, name: "Animation" }], seasons: [{ season_number: 0, episode_count: 4 }, { season_number: 1, episode_count: 38 }] }),
    } as unknown as Tmdb;
    const map = ids();
    map.ready = async () => {};
    const matcher = new AnimeMatcher(anilist, map, tmdb);
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren S2 - 02 (1080p) [ABCD1234].mkv"))).toMatchObject({ type: "show", tmdbId: 209867, season: 1, episode: 30 });
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))).toMatchObject({ tmdbId: 209867, season: 1, episode: 12 });
  });
});

test("films map to TMDB (the list gives movie ids as an array)", () => {
  expect(ids().kitsu(11614)?.tmdbMovie).toBe(372058);
  expect(ids().anilist(21519)?.tmdbMovie).toBe(372058);
});

describe("Torrentio anime ids", () => {
  test("TMDB episodes become the Kitsu entry and its own episode number", () => {
    const map = ids();
    const frieren = [{ season: 1, episodes: 38 }];
    expect(kitsuEpisode(map.show(209867), 1, 12, frieren)).toEqual({ kitsuId: 46474, episode: 12 });
    expect(kitsuEpisode(map.show(209867), 1, 30, frieren)).toEqual({ kitsuId: 49240, episode: 2 }); // S2 entry
    const onePiece = [{ season: 0, episodes: 50 }, { season: 1, episodes: 61 }, { season: 2, episodes: 16 }];
    expect(kitsuEpisode(map.show(37854), 2, 9, onePiece)).toEqual({ kitsuId: 12, episode: 70 }); // absolute
    expect(kitsuEpisode(map.show(99999), 1, 1, frieren)).toBeNull();
  });

  test("Torrentio's anime picks count as the episode whatever their own numbering", () => {
    const release = (title: string, targeted: boolean): Release => ({ hash: "a".repeat(40), title, origin: "torrentio", cached: false, isPack: false, targeted, parsed: parseFileName(title) });
    const target = { mediaType: "episode" as const, tmdbId: 209867, season: 1, episode: 30 };
    expect(relevant(release("[SubsPlease] Sousou no Frieren - 02 (1080p)", true), target)).toBe(true);
    expect(relevant(release("[SubsPlease] Sousou no Frieren - 02 (1080p)", false), target)).toBe(false);
  });
});

test("malformed entries in the downloaded list are ignored, not trusted", () => {
  const map = new AnimeIds("/nonexistent");
  map.index([
    { anilist_id: 1, themoviedb_id: { tv: "../movie/1" as unknown as number }, season: { tmdb: -3 }, episode_offset: { tmdb: 1.5 } },
    { anilist_id: 2, themoviedb_id: { tv: 42 }, season: { tvdb: 1, tmdb: 1 } },
    null as unknown as object,
  ]);
  // An invalid season/offset drops the whole entry instead of turning it "absolute".
  expect(map.anilist(1)).toBeUndefined();
  expect(map.show(42)[0]?.anilistId).toBe(2);
});

test("AniList: identical lookups share one request, failures back off", async () => {
  const { Anilist } = await import("../src/catalog/anime/anilist");
  const { startTestServer } = await import("./helpers");
  const server = await startTestServer();
  let calls = 0;
  const anilist = new Anilist(server.services.db, (async () => {
    calls++;
    return new Response("busy", { status: 500 });
  }) as unknown as typeof fetch);
  const [a, b] = await Promise.all([anilist.media(7), anilist.media(7)]);
  expect([a, b]).toEqual([null, null]);
  expect(calls).toBe(1); // shared
  await anilist.media(7);
  expect(calls).toBe(1); // failed recently: not retried
  server.services.shutdown();
});

describe("Kitsu", () => {
  const kitsuWith = async (body: unknown, seen: string[]) => {
    const { Kitsu } = await import("../src/catalog/anime/kitsu");
    const { startTestServer } = await import("./helpers");
    const server = await startTestServer();
    const kitsu = new Kitsu(server.services.db, (async (url: string) => {
      seen.push(decodeURIComponent(String(url)));
      return Response.json(body);
    }) as unknown as typeof fetch);
    return { kitsu, server };
  };

  test("season rails ask for this and last season, wrapping the year", async () => {
    const seen: string[] = [];
    const { kitsu, server } = await kitsuWith({ data: [{ id: "46474", attributes: {} }] }, seen);
    expect(await kitsu.rail("series", "season", new Date("2026-01-15"))).toEqual([46474]);
    await kitsu.rail("series", "lastSeason", new Date("2026-01-15"));
    expect(seen[0]).toContain("filter[season]=winter&filter[seasonYear]=2026");
    expect(seen[1]).toContain("filter[season]=fall&filter[seasonYear]=2025");
    server.services.shutdown();
  });

  test("a file AniList can't place is matched through Kitsu's search", async () => {
    const seen: string[] = [];
    const { kitsu, server } = await kitsuWith({ data: [{ id: "46474", attributes: { canonicalTitle: "Sousou no Frieren", titles: { en_jp: "Sousou no Frieren" }, subtype: "TV", startDate: "2023-09-29" } }] }, seen);
    const anilist = { search: async () => [] } as unknown as Anilist;
    const tmdb = { show: async () => ({ id: 209867, name: "Frieren", first_air_date: "2023-09-29", genres: [], seasons: [{ season_number: 1, episode_count: 38 }] }) } as unknown as Tmdb;
    const map = ids();
    map.ready = async () => {};
    const matcher = new AnimeMatcher(anilist, map, tmdb, kitsu);
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))).toMatchObject({ tmdbId: 209867, season: 1, episode: 12 });
    server.services.shutdown();
  });
});
