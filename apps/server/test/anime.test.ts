import { describe, expect, test } from "bun:test";
import { AnimeIds, fileAnimeIdStore, kitsuEpisode } from "../src/catalog/anime/ids";
import { relevant, type Release } from "../src/sources/discovery";
import { AnimeMatcher, pickAnime, resolveEpisode } from "../src/catalog/anime/match";
import type { Anilist } from "../src/catalog/anime/anilist";
import type { Tmdb } from "../src/catalog/tmdb";
import { CatalogService, legacyCards, plainDescription } from "../src/catalog/service";
import { parseFileName } from "../src/media/parse";

// Real entries from Fribb/anime-lists (trimmed).
const RAW = [
  { type: "TV", anilist_id: 154587, kitsu_id: 46474, themoviedb_id: { tv: 209867 }, season: { tvdb: 1, tmdb: 1 } }, // Frieren
  { type: "TV", anilist_id: 182255, kitsu_id: 49240, themoviedb_id: { tv: 209867 }, season: { tvdb: 2, tmdb: 1 }, episode_offset: { tmdb: 28 } }, // Frieren S2
  { type: "TV", anilist_id: 21, kitsu_id: 12, themoviedb_id: { tv: 37854 } }, // One Piece: absolute
  { type: "MOVIE", anilist_id: 21519, kitsu_id: 11614, themoviedb_id: { movie: [372058] } }, // Your Name.
];

const ids = () => {
  const map = new AnimeIds(fileAnimeIdStore("/nonexistent"));
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

/** AniList's title pages for the matcher's artwork: Frieren, its S2, One Piece and Your Name. */
const TITLES: Record<number, object> = {
  154587: { id: 154587, format: "TV", seasonYear: 2023, title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" }, coverImage: { extraLarge: "https://img.anili.st/154587.jpg" }, bannerImage: "https://img.anili.st/b154587.jpg" },
  182255: { id: 182255, format: "TV", seasonYear: 2026, title: { romaji: "Sousou no Frieren 2nd Season" }, coverImage: { large: "https://img.anili.st/182255.jpg" } },
  21: { id: 21, format: "TV", seasonYear: 1999, title: { romaji: "ONE PIECE" } },
  21519: { id: 21519, format: "MOVIE", seasonYear: 2016, title: { romaji: "Kimi no Na wa.", english: "Your Name." } },
};
const anilistTitle = async (id: number) => TITLES[id] ?? null;

describe("AnimeMatcher", () => {
  test("a fansub file becomes the AniList entry it belongs to and that entry's own episode", async () => {
    const anilist = {
      search: async () => [{ id: 182255, format: "TV", title: { romaji: "Sousou no Frieren 2nd Season" } }, { id: 154587, format: "TV", title: { romaji: "Sousou no Frieren" } }],
      title: anilistTitle,
    } as unknown as Anilist;
    const tmdb = {
      show: async () => ({ id: 209867, name: "Frieren: Beyond Journey's End", first_air_date: "2023-09-29", genres: [{ id: 16, name: "Animation" }], seasons: [{ season_number: 0, episode_count: 4 }, { season_number: 1, episode_count: 38 }] }),
    } as unknown as Tmdb;
    const map = ids();
    map.ready = async () => {};
    const matcher = new AnimeMatcher(anilist, map, tmdb);
    // "S2 - 02" picks Frieren, which the id list places on TMDB S1E30: the S2 entry's episode 2.
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren S2 - 02 (1080p) [ABCD1234].mkv"))).toEqual({
      source: "anilist", type: "show", titleId: 182255, title: "Sousou no Frieren 2nd Season", year: 2026, posterPath: "https://img.anili.st/182255.jpg", backdropPath: null, genreIds: null, season: 1, episode: 2,
    });
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))).toMatchObject({ source: "anilist", titleId: 154587, title: "Frieren: Beyond Journey's End", backdropPath: "https://img.anili.st/b154587.jpg", season: 1, episode: 12 });
    // Numbered on from S1 ("- 30"): still the S2 entry's episode 2.
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 30 (1080p).mkv"))).toMatchObject({ titleId: 182255, season: 1, episode: 2 });
  });

  test("titles the id list doesn't know yet keep the file's episode; films are AniList movies", async () => {
    const anilist = {
      search: async (q: string) => (q.includes("Kimi") ? [{ id: 21519, format: "MOVIE", title: { romaji: "Kimi no Na wa." } }] : [{ id: 999, format: "TV", title: { romaji: "Brand New Anime" } }]),
      title: async (id: number) => TITLES[id] ?? { id, format: "TV", title: { romaji: "Brand New Anime" } },
    } as unknown as Anilist;
    const map = ids();
    map.ready = async () => {};
    const matcher = new AnimeMatcher(anilist, map, {} as Tmdb);
    expect(await matcher.match(parseFileName("[SubsPlease] Brand New Anime - 07 (1080p).mkv"))).toMatchObject({ source: "anilist", type: "show", titleId: 999, season: 1, episode: 7 });
    expect(await matcher.match(parseFileName("[Group] Kimi no Na wa. (2016) (1080p).mkv"))).toMatchObject({ source: "anilist", type: "movie", titleId: 21519, title: "Your Name." });
  });

  test("AniList being down leaves the file for later rather than matching it to TMDB", async () => {
    const { AnilistUnavailableError } = await import("../src/catalog/anime/anilist");
    const anilist = { search: async () => Promise.reject(new AnilistUnavailableError()) } as unknown as Anilist;
    const map = ids();
    map.ready = async () => {};
    const { Matcher } = await import("../src/catalog/matcher");
    const tmdb = { searchShow: async () => ({ results: [{ id: 209867, name: "Sousou no Frieren" }] }) } as unknown as Tmdb;
    const matcher = new Matcher(tmdb, new AnimeMatcher(anilist, map, tmdb));
    await expect(matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))).rejects.toThrow("AniList");
  });
});

describe("TMDB episodes on AniList entries", () => {
  test("a season's later cour, absolute numbering across cours, and a one-season show", async () => {
    const { anilistEpisode, tmdbEpisodeOf } = await import("../src/catalog/anime/ids");
    const map = new AnimeIds(fileAnimeIdStore("/nonexistent"));
    map.index([
      ...RAW,
      // A show numbered absolutely in two AniList cours (the second from absolute episode 13).
      { anilist_id: 501, themoviedb_id: { tv: 7000 } },
      { anilist_id: 502, themoviedb_id: { tv: 7000 }, episode_offset: { tmdb: 12 } },
      // A TMDB S2 that's its own AniList entry.
      { anilist_id: 601, themoviedb_id: { tv: 8000 }, season: { tmdb: 1 } },
      { anilist_id: 602, themoviedb_id: { tv: 8000 }, season: { tmdb: 2 } },
    ]);
    const frieren = [{ season: 1, episodes: 38 }];
    expect(anilistEpisode(map.show(209867), 1, 12, frieren)).toEqual({ anilistId: 154587, episode: 12 });
    expect(anilistEpisode(map.show(209867), 1, 30, frieren)).toEqual({ anilistId: 182255, episode: 2 });
    const twoCours = [{ season: 0, episodes: 3 }, { season: 1, episodes: 10 }, { season: 2, episodes: 14 }];
    expect(anilistEpisode(map.show(7000), 1, 5, twoCours)).toEqual({ anilistId: 501, episode: 5 });
    expect(anilistEpisode(map.show(7000), 2, 2, twoCours)).toEqual({ anilistId: 501, episode: 12 });
    expect(anilistEpisode(map.show(7000), 2, 3, twoCours)).toEqual({ anilistId: 502, episode: 1 });
    expect(anilistEpisode(map.show(8000), 2, 4, [])).toEqual({ anilistId: 602, episode: 4 });
    expect(anilistEpisode(map.show(8000), 3, 1, [])).toBeNull();
    expect(anilistEpisode(map.show(37854), 2, 9, [{ season: 1, episodes: 61 }, { season: 2, episodes: 16 }])).toEqual({ anilistId: 21, episode: 70 });
    // And back: an entry's episode on TMDB.
    expect(tmdbEpisodeOf(map.anilist(182255)!, 2, frieren)).toEqual({ season: 1, episode: 30 });
    expect(tmdbEpisodeOf(map.anilist(502)!, 1, twoCours)).toEqual({ season: 2, episode: 3 });
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
    const target = { source: "tmdb" as const, mediaType: "episode" as const, titleId: 209867, season: 1, episode: 30 };
    expect(relevant(release("[SubsPlease] Sousou no Frieren - 02 (1080p)", true), target)).toBe(true);
    expect(relevant(release("[SubsPlease] Sousou no Frieren - 02 (1080p)", false), target)).toBe(false);
  });
});

test("malformed entries in the downloaded list are ignored, not trusted", () => {
  const map = new AnimeIds(fileAnimeIdStore("/nonexistent"));
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
  const anilist = new Anilist(server.services.cache, (async () => {
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
    const kitsu = new Kitsu(server.services.cache, (async (url: string) => {
      seen.push(decodeURIComponent(String(url)));
      return Response.json(body);
    }) as unknown as typeof fetch);
    return { kitsu, server };
  };

  test("season rails ask for this and last season, wrapping the year", async () => {
    const seen: string[] = [];
    const { kitsu, server } = await kitsuWith({ data: [{ id: "46474", attributes: {} }] }, seen);
    expect(await kitsu.rail("series", "season", { now: new Date("2026-01-15") })).toEqual([46474]);
    await kitsu.rail("series", "lastSeason", { now: new Date("2026-01-15"), category: "isekai" });
    await kitsu.rail("series", "top", { category: "../evil" });
    expect(seen[0]).toContain("filter[season]=winter&filter[seasonYear]=2026");
    expect(seen[1]).toContain("filter[season]=fall&filter[seasonYear]=2025");
    expect(seen[1]).toContain("filter[categories]=isekai");
    expect(seen[2]).not.toContain("categories"); // unknown categories are dropped
    server.services.shutdown();
  });

  test("a file AniList can't place is matched through Kitsu's search, to the AniList entry", async () => {
    const seen: string[] = [];
    const { kitsu, server } = await kitsuWith({ data: [{ id: "46474", attributes: { canonicalTitle: "Sousou no Frieren", titles: { en_jp: "Sousou no Frieren" }, subtype: "TV", startDate: "2023-09-29" } }] }, seen);
    const anilist = { search: async () => [], title: anilistTitle } as unknown as Anilist;
    const tmdb = { show: async () => ({ id: 209867, name: "Frieren", first_air_date: "2023-09-29", genres: [], seasons: [{ season_number: 1, episode_count: 38 }] }) } as unknown as Tmdb;
    const map = ids();
    map.ready = async () => {};
    const matcher = new AnimeMatcher(anilist, map, tmdb, kitsu);
    expect(await matcher.match(parseFileName("[SubsPlease] Sousou no Frieren - 12 (1080p).mkv"))).toMatchObject({ source: "anilist", titleId: 154587, season: 1, episode: 12 });
    server.services.shutdown();
  });
});

test("an unreadable anime id list is thrown away and retried later, not reread on every lookup", async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "strata-anime-"));
  writeFileSync(join(dir, "anime-ids.json"), "{not json");
  let downloads = 0;
  const map = new AnimeIds(fileAnimeIdStore(dir), (async () => {
    downloads++;
    return new Response("busy", { status: 503 });
  }) as unknown as typeof fetch);
  await map.ready();
  expect(existsSync(join(dir, "anime-ids.json"))).toBe(false);
  await map.ready();
  await map.ready();
  expect(downloads).toBe(1); // one try for a fresh copy, then a pause before the next
});

test("on Workers lookups never download the list; only the daily refresh does", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "strata-anime-"));
  let downloads = 0;
  const map = new AnimeIds(
    fileAnimeIdStore(dir),
    (async () => {
      downloads++;
      return Response.json(Array.from({ length: 1000 }, (_, i) => ({ anilist_id: i + 1, themoviedb_id: { tv: i + 1 } })));
    }) as unknown as typeof fetch,
    false,
  );
  await map.ready();
  expect(downloads).toBe(0);
  expect(map.size).toBe(0);
  await map.refresh();
  expect(downloads).toBe(1);
  expect(map.anilist(5)?.tmdbTv).toBe(5);
});

describe("anime tab sections", () => {
  const detail = (id: number, name: string) => ({ id, name, title: name, overview: `${name}.`, poster_path: "/p.jpg", backdrop_path: "/b.jpg", first_air_date: "2023-09-29", release_date: "2016-08-26" });
  const tmdb = {
    show: async (id: number) => (id === 209867 ? detail(id, "Frieren") : id === 37854 ? detail(id, "One Piece") : Promise.reject(new Error("404"))),
    movie: async (id: number) => (id === 372058 ? detail(id, "Your Name.") : Promise.reject(new Error("404"))),
  } as unknown as Tmdb;
  const library = { availability: () => new Map() } as never;
  const catalog = (home: unknown) => {
    const map = ids();
    map.ready = async () => {};
    return new CatalogService(tmdb, library, {} as never, () => ({}) as never, { ids: map, anilist: { home: async () => home } as unknown as Anilist });
  };
  const card = (id: number, format: string, english: string | null, extra: object = {}) => ({
    id,
    format,
    title: { english, romaji: `${english ?? "Romaji"} (romaji)` },
    coverImage: { extraLarge: `https://img.anili.st/${id}.jpg` },
    description: `${english ?? "Romaji"}<br><br>An <i>anime</i> &amp; more.`,
    averageScore: 85,
    seasonYear: 2023,
    ...extra,
  });
  // Frieren's two seasons are one TMDB show; 999 is on AniList only (nothing in Fribb's list).
  const all = [
    card(154587, "TV", "Frieren", { episodes: 28 }),
    card(182255, "TV", "Frieren Season 2", { episodes: 10, description: null }),
    card(21, "TV", "One Piece"),
    card(21519, "MOVIE", "Your Name.", { episodes: 1 }),
    card(999, "TV", null, { bannerImage: "https://img.anili.st/banner/999.jpg" }),
  ];
  const fall = { season: "FALL", year: 2026 };

  test("AniList's lists become the hero and rails, every entry its own card, from AniList's data", async () => {
    const shelves = await catalog({
      currentSeason: fall,
      trending: all,
      season: all,
      airing: all,
      popular: all,
      favourites: all,
      completed: all,
      upcoming: [],
      latest: [{ ...all[1]!, aired: { episode: 4, airingAt: 0 } }, { ...all[2]!, aired: { episode: 1150, airingAt: 0 } }, all[3]!],
    }).animePage();
    expect(shelves.map((s) => [s.id, s.title, s.style ?? null])).toEqual([
      ["anime-spotlight", "Spotlight", "hero"],
      ["anime-trending", "Trending", null],
      ["anime-this-season", "Fall 2026 Anime", null],
      ["anime-latest-episodes", "Latest Episodes", null],
      ["anime-top-airing", "Airing Now", null],
      ["anime-most-popular", "Popular", null],
      ["anime-most-favorite", "Fan Favorites", null],
      ["anime-latest-completed", "Recently Finished", null],
    ]); // Coming Soon has nothing, so it's left out
    const trending = shelves[1]!.items;
    // Nothing left out: both Frieren seasons, and the title only AniList has.
    expect(trending.map((c) => c.ref)).toEqual(["anilist:show:154587", "anilist:show:182255", "anilist:show:21", "anilist:movie:21519", "anilist:show:999"]);
    expect(trending.map((c) => c.title)).toEqual(["Frieren", "Frieren Season 2", "One Piece", "Your Name.", "Romaji (romaji)"]);
    expect(trending.map((c) => c.tmdbId)).toEqual([209867, 209867, 37854, 372058, undefined]);
    expect(trending[0]).toMatchObject({ overview: "Frieren\n\nAn anime & more.", posterUrl: "https://img.anili.st/154587.jpg", rating: 8.5, year: 2023 });
    // The hero: titles with a synopsis, on TMDB's backdrop where TMDB has them, else AniList's banner.
    const hero = shelves[0]!.items;
    expect(hero.map((c) => c.ref)).toEqual(["anilist:show:154587", "anilist:show:21", "anilist:movie:21519", "anilist:show:999"]);
    expect(hero.map((c) => c.backdropUrl)).toEqual([
      "https://image.tmdb.org/t/p/original/b.jpg",
      "https://image.tmdb.org/t/p/original/b.jpg",
      "https://image.tmdb.org/t/p/original/b.jpg",
      "https://img.anili.st/banner/999.jpg",
    ]);
    expect(hero.map((c) => c.eyebrow)).toEqual(["#1 in Anime", "#2 in Anime", "#3 in Anime", "#4 in Anime"]);
    expect(shelves[3]!.items.map((c) => c.badge)).toEqual(["Episode 4", "Episode 1150", undefined]);
  });

  test("an upcoming later season is labelled \"New season\"", async () => {
    // Frieren S2 (TMDB S1 E29+): a new season of a show TMDB already has.
    const later = [all[1]!, all[2]!, all[3]!];
    const shelves = await catalog({ currentSeason: fall, trending: [], season: [], airing: [], popular: [], favourites: [], completed: [], upcoming: later, latest: [] }).animePage();
    const badges = (id: string) => shelves.find((s) => s.id === id)!.items.map((c) => c.badge);
    expect(badges("anime-upcoming")).toEqual(["New season", undefined, undefined]);
  });

  test("each rail links to its full list, which has every title AniList ranks", async () => {
    const home = { currentSeason: fall, trending: all, season: all, airing: all, popular: all, favourites: all, completed: all, upcoming: [], latest: [] };
    const shelves = await catalog(home).animePage();
    expect(shelves.find((s) => s.id === "anime-trending")!.more).toBe("trending");
    expect(shelves.find((s) => s.id === "anime-this-season")!.more).toBe("season");
    expect(shelves.find((s) => s.id === "anime-top-airing")!.more).toBe("airing");
    const map = ids();
    map.ready = async () => {};
    const asked: string[] = [];
    const anilist = { home: async () => home, list: async (name: string) => (asked.push(name), all) } as unknown as Anilist;
    const full = new CatalogService(tmdb, library, {} as never, () => ({}) as never, { ids: map, anilist });
    const trending = await full.animeList("trending");
    expect(trending!.title).toBe("Trending");
    expect(trending!.items.length).toBe(5);
    expect((await full.animeList("season"))!.title).toMatch(/^(Winter|Spring|Summer|Fall) \d{4} Anime$/);
    expect(asked).toEqual(["trending", "season"]);
    expect(await full.animeList("../evil")).toBeNull();
  });

  test("apps from before refs get only titles TMDB has, once each", () => {
    const cards = [
      { type: "show", ref: "anilist:show:154587", tmdbId: 209867 },
      { type: "show", ref: "anilist:show:182255", tmdbId: 209867 },
      { type: "show", ref: "anilist:show:999" },
      { type: "movie", ref: "anilist:movie:21519", tmdbId: 372058 },
      { type: "show", ref: "tmdb:show:372058", tmdbId: 372058 },
    ];
    expect(legacyCards(cards).map((c) => c.ref)).toEqual(["anilist:show:154587", "anilist:movie:21519", "tmdb:show:372058"]);
  });

  test("AniList's descriptions are shown as plain text", () => {
    expect(plainDescription("A<br>B<br/><br />C <i>D</i> &quot;E&quot; &#039;F&#039;")).toBe("A\nB\n\nC D \"E\" 'F'");
    expect(plainDescription("<br>")).toBeUndefined();
    expect(plainDescription("A &amp;lt;b&amp;gt; tag")).toBe("A &lt;b&gt; tag");
    expect(plainDescription("x<scr<b>ipt>alert(1)</scr</b>ipt>y")).toBe("xalert(1)y");
    expect(plainDescription(null)).toBeUndefined();
  });

  test("when AniList can't answer, the tab falls back to Kitsu's rails (none here)", async () => {
    expect(await catalog(null).animePage()).toEqual([]);
  });
});

describe("shows tab", () => {
  const today = new Date().toISOString().slice(0, 10);
  const item = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `Show ${id}`, overview: "…", poster_path: "/p.jpg", backdrop_path: "/b.jpg", original_language: "en", genre_ids: [18], ...extra });
  const page = (ids: number[]) => ({ results: ids.map((id) => item(id)) });
  const tmdb = {
    trending: async () => page([1, 2, 3, 4]),
    popular: async () => page([1, 2, 3]),
    topRated: async () => page([2, 3, 4]),
    discover: async () => page([1, 2, 3, 4]),
    // 1–3 had an episode this week; 4's last one aired long ago.
    show: async (id: number) => item(id, { last_episode_to_air: { season_number: 2, episode_number: id, air_date: id === 4 ? "2020-01-01" : today } }),
  } as unknown as Tmdb;
  const library = { availability: () => new Map() } as never;

  test("rails like the Anime tab's, with the episode that just aired on each latest card", async () => {
    const shelves = await new CatalogService(tmdb, library, {} as never, () => ({}) as never).showsPage();
    expect(shelves.map((s) => [s.id, s.style ?? null])).toEqual([
      ["shows-spotlight", "hero"],
      ["shows-trending", null],
      ["shows-latest-episodes", null],
      ["shows-new", null],
      ["shows-popular", null],
      ["shows-top-rated", null],
      ["shows-coming-soon", null],
    ]);
    expect(shelves[0]!.items[0]!.eyebrow).toBe("#1 in Shows");
    expect(shelves[2]!.items.map((c) => c.badge)).toEqual(["S2 · E1", "S2 · E2", "S2 · E3"]);
  });
});
