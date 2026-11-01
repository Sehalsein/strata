import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Anilist, type AnilistTitle } from "../src/catalog/anime/anilist";
import { AnimeIds, fileAnimeIdStore } from "../src/catalog/anime/ids";
import type { Kitsu } from "../src/catalog/anime/kitsu";
import { ContentFilter } from "../src/catalog/contentRating";
import { CatalogService } from "../src/catalog/service";
import type { Tmdb } from "../src/catalog/tmdb";
import { parseRef, type TitleRef } from "../src/catalog/ref";

// Fribb's entries (trimmed): Frieren's two seasons are TMDB S1 and S1 E29+; One Piece is
// numbered across TMDB's seasons; 999 and 777 are AniList only; 555 is on TMDB but not Kitsu.
const RAW = [
  { type: "TV", anilist_id: 154587, kitsu_id: 46474, themoviedb_id: { tv: 209867 }, season: { tvdb: 1, tmdb: 1 } },
  { type: "TV", anilist_id: 182255, kitsu_id: 49240, themoviedb_id: { tv: 209867 }, season: { tvdb: 2, tmdb: 1 }, episode_offset: { tmdb: 28 } },
  { type: "TV", anilist_id: 21, kitsu_id: 12, themoviedb_id: { tv: 37854 } },
  { type: "MOVIE", anilist_id: 21519, kitsu_id: 11614, themoviedb_id: { movie: [372058] } },
  { type: "TV", anilist_id: 555, themoviedb_id: { tv: 5550 }, season: { tmdb: 1 } },
  { type: "TV", anilist_id: 777, kitsu_id: 7770 },
];

const ids = () => {
  const map = new AnimeIds(fileAnimeIdStore("/nonexistent"));
  map.index(RAW);
  map.ready = async () => {};
  return map;
};

const linked = (id: number, format: string, english: string, extra: object = {}) => ({
  id,
  type: "ANIME",
  format,
  title: { english, romaji: `${english} (romaji)` },
  coverImage: { extraLarge: `https://img.anili.st/${id}.jpg` },
  seasonYear: 2023,
  ...extra,
});

const NOW = Math.floor(Date.now() / 1000);
const MEDIA: Record<number, AnilistTitle> = {
  // Frieren season 2: airing, episode 4 next.
  182255: {
    ...linked(182255, "TV", "Frieren Season 2"),
    title: { english: "Frieren Season 2", romaji: "Sousou no Frieren 2nd Season", native: "葬送のフリーレン 第2期" },
    description: "The <i>journey</i> continues.<br><br>More &amp; more.",
    status: "RELEASING",
    episodes: 10,
    duration: 24,
    genres: ["Adventure", "Fantasy"],
    averageScore: 90,
    startDate: { year: 2026, month: 1, day: 16 },
    bannerImage: "https://img.anili.st/banner/182255.jpg",
    studios: { nodes: [{ name: "Madhouse", isAnimationStudio: true }, { name: "Aniplex", isAnimationStudio: false }] },
    nextAiringEpisode: { episode: 4, airingAt: NOW + 86_400 },
    airingSchedule: { nodes: [{ episode: 4, airingAt: Date.UTC(2026, 1, 6) / 1000 }, { episode: 5, airingAt: Date.UTC(2026, 1, 13) / 1000 }] },
    trailer: { id: "yt123", site: "youtube" },
    relations: {
      edges: [
        { relationType: "PREQUEL", node: linked(154587, "TV", "Frieren") },
        { relationType: "ADAPTATION", node: { ...linked(1, "MANGA", "Frieren (manga)"), type: "MANGA" } },
        { relationType: "SEQUEL", node: linked(300, "TV", "Frieren Season 3") },
        { relationType: "SIDE_STORY", node: linked(301, "MOVIE", "Frieren: The Movie") },
        { relationType: "CHARACTER", node: linked(302, "TV", "Someone else") },
      ],
    },
    recommendations: { nodes: [{ mediaRecommendation: linked(999, "TV", "Only On AniList") }, { mediaRecommendation: { ...linked(666, "TV", "Adult"), isAdult: true } }, { mediaRecommendation: null }] },
  },
  // On AniList only: no TMDB backdrop, no TMDB episodes.
  999: {
    ...linked(999, "TV", "Only On AniList"),
    status: "FINISHED",
    episodes: 3,
    bannerImage: "https://img.anili.st/banner/999.jpg",
    startDate: { year: 2020, month: 4, day: 1 },
    endDate: { year: 2020, month: 6, day: 30 },
  },
  21519: { ...linked(21519, "MOVIE", "Your Name."), status: "FINISHED", episodes: 1, duration: 106, startDate: { year: 2016, month: 8, day: 26 } },
  666: { ...linked(666, "TV", "Adult"), isAdult: true, status: "FINISHED", episodes: 2 },
};

const tmdb = {
  show: async (id: number) => {
    if (id === 209867) return { id, name: "Frieren", backdrop_path: "/frieren.jpg", genres: [], seasons: [{ season_number: 1, episode_count: 38 }] };
    if (id === 5550) return { id, name: "Mapped", genres: [{ id: 16, name: "Animation" }], seasons: [], content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-PG" }] } };
    throw new Error("404");
  },
  movie: async (id: number) => {
    if (id === 372058) return { id, title: "Your Name.", backdrop_path: "/yourname.jpg", genres: [] };
    throw new Error("404");
  },
  season: async (id: number, season: number) => {
    if (id !== 209867 || season !== 1) throw new Error("404");
    // TMDB has 31 of the 38 episodes so far.
    return {
      season_number: 1,
      episodes: Array.from({ length: 31 }, (_, i) => ({ season_number: 1, episode_number: i + 1, name: `TMDB E${i + 1}`, overview: `Overview ${i + 1}`, air_date: "2026-01-16", still_path: `/s${i + 1}.jpg`, vote_average: 8 })),
    };
  },
} as unknown as Tmdb;

const KITSU: Record<number, string | null> = { 46474: "PG", 49240: "PG", 11614: "PG", 7770: "R" };
const kitsu = { ageRating: async (id: number) => KITSU[id] ?? null } as unknown as Kitsu;

const library = { availability: async () => new Map(), filesFor: async () => [] } as never;
const progress = { get: async () => undefined, forShow: async () => [], inWatchlist: async () => false } as never;
const settings = () => ({ region: "US" }) as never;
const catalog = () => new CatalogService(tmdb, library, progress, settings, { ids: ids(), anilist: { title: async (id: number) => MEDIA[id] ?? null } as unknown as Anilist, kitsu });
const ref = (text: string) => parseRef(text)!;

describe("AniList title pages", () => {
  test("a show: AniList's data in TMDB's page shape, TMDB's backdrop, other seasons and recommendations as AniList cards", async () => {
    const page = (await catalog().anilistTitle("u", ref("anilist:show:182255"))) as Record<string, any>;
    expect(page).toMatchObject({
      type: "show",
      ref: "anilist:show:182255",
      tmdbId: 209867,
      imdbId: null,
      title: "Frieren Season 2",
      tagline: null,
      overview: "The journey continues.\n\nMore & more.",
      year: 2023,
      firstAirDate: "2026-01-16",
      lastAirDate: null,
      status: "Returning Series",
      genres: ["Adventure", "Fantasy"],
      rating: 9,
      ratings: null,
      certification: "PG",
      posterUrl: "https://img.anili.st/182255.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w1280/frieren.jpg",
      cast: [],
      trailer: { site: "youtube", key: "yt123", name: "Trailer" },
      available: [],
      inWatchlist: false,
      upNext: { season: 1, episode: 1, positionMs: 0, available: false },
      anime: { anilistId: 182255, romaji: "Sousou no Frieren 2nd Season", native: "葬送のフリーレン 第2期", studios: ["Madhouse"], score: 90, nextEpisode: { episode: 4, airsAt: (NOW + 86_400) * 1000 } },
    });
    expect(page.videos).toEqual([{ key: "yt123", name: "Trailer", type: "Trailer", url: "https://www.youtube.com/watch?v=yt123", thumbnailUrl: "https://i.ytimg.com/vi/yt123/hqdefault.jpg" }]);
    expect(page.seasons).toEqual([{ season: 1, name: "Episodes", episodeCount: 10, airDate: "2026-01-16", posterUrl: "https://img.anili.st/182255.jpg", availableEpisodes: 0 }]);
    // Sequels first; manga and other relations left out.
    expect(page.related.map((c: any) => [c.ref, c.badge])).toEqual([
      ["anilist:show:300", "Sequel"],
      ["anilist:show:154587", "Prequel"],
      ["anilist:movie:301", "Side Story"],
    ]);
    expect(page.related[1].tmdbId).toBe(209867);
    // Adult recommendations are left out.
    expect(page.recommendations.map((c: any) => c.ref)).toEqual(["anilist:show:999"]);
  });

  test("a title only AniList has: its banner as the backdrop, no TMDB id", async () => {
    const page = (await catalog().anilistTitle("u", ref("anilist:show:999"))) as Record<string, any>;
    expect(page.backdropUrl).toBe("https://img.anili.st/banner/999.jpg");
    expect("tmdbId" in page).toBe(false);
    expect(page).toMatchObject({ status: "Ended", lastAirDate: "2020-06-30", certification: null, trailer: null, videos: [], related: [], recommendations: [] });
    expect(page.seasons[0].episodeCount).toBe(3);
  });

  test("season 1: TMDB's names where Fribb maps the title, AniList's numbers, and what's still to air", async () => {
    const season = (await catalog().anilistSeason("u", ref("anilist:show:182255"), 1))!;
    expect(season).toMatchObject({ season: 1, name: "Episodes", posterUrl: "https://img.anili.st/182255.jpg" });
    expect(season.episodes).toHaveLength(10);
    // AniList's episode 1 is TMDB's S1 E29.
    expect(season.episodes[0]).toMatchObject({ season: 1, episode: 1, name: "TMDB E29", overview: "Overview 29", stillUrl: "https://image.tmdb.org/t/p/w780/s29.jpg", runtimeMinutes: 24, airDate: "2026-01-16" });
    expect(season.episodes[2]!.name).toBe("TMDB E31");
    // TMDB doesn't have it yet; AniList's schedule says when it airs.
    expect(season.episodes[3]).toMatchObject({ episode: 4, name: "Episode 4", airDate: "2026-02-06", stillUrl: null });
    expect(season.episodes[9]).toMatchObject({ episode: 10, name: "Episode 10", airDate: null });
  });

  test("season 1 of a title only AniList has is numbered episodes; other seasons don't exist", async () => {
    const service = catalog();
    const season = (await service.anilistSeason("u", ref("anilist:show:999"), 1))!;
    expect(season.episodes.map((e) => e.name)).toEqual(["Episode 1", "Episode 2", "Episode 3"]);
    expect(await service.anilistSeason("u", ref("anilist:show:182255"), 2)).toBeNull();
    expect(await service.anilistSeason("u", ref("anilist:movie:21519"), 1)).toBeNull();
  });

  test("a film: the movie page shape, its runtime from AniList", async () => {
    const page = (await catalog().anilistTitle("u", ref("anilist:movie:21519"))) as Record<string, any>;
    expect(page).toMatchObject({
      type: "movie",
      ref: "anilist:movie:21519",
      tmdbId: 372058,
      releaseDate: "2016-08-26",
      runtimeMinutes: 106,
      backdropUrl: "https://image.tmdb.org/t/p/w1280/yourname.jpg",
      directors: [],
      collection: null,
      sources: [],
      progress: null,
    });
  });

  test("adult titles, unknown titles and the wrong type have no page", async () => {
    const service = catalog();
    expect(await service.anilistTitle("u", ref("anilist:show:666"))).toBeNull();
    expect(await service.anilistTitle("u", ref("anilist:show:12345"))).toBeNull();
    expect(await service.anilistTitle("u", ref("anilist:movie:182255"))).toBeNull();
  });
});

describe("content limits for AniList titles", () => {
  const filter = (maxAge: number | null) => {
    const content = new ContentFilter({} as never, "org", tmdb, settings, { ids: ids(), kitsu });
    content.maxAge = async () => maxAge;
    return content;
  };
  const allowed = (maxAge: number, text: string) => filter(maxAge).allowed("u", ref(text) as TitleRef);

  test("Kitsu's rating decides: PG (which takes in PG-13) fits 13, not 10; R needs 17", async () => {
    expect(await allowed(13, "anilist:show:154587")).toBe(true);
    expect(await allowed(10, "anilist:show:154587")).toBe(false);
    expect(await allowed(14, "anilist:show:777")).toBe(false);
    expect(await allowed(17, "anilist:show:777")).toBe(true);
  });

  test("when Kitsu can't answer, the title stays hidden under a limit (not TMDB's milder rating)", async () => {
    const down = { ageRating: async () => Promise.reject(new Error("Kitsu down")) } as unknown as Kitsu;
    const content = new ContentFilter({} as never, "org", tmdb, settings, { ids: ids(), kitsu: down });
    content.maxAge = async () => 17;
    expect(await content.allowed("u", ref("anilist:show:154587"))).toBe(false);
  });

  test("without a Kitsu id, TMDB's certification for the mapped title", async () => {
    expect(await allowed(10, "anilist:show:555")).toBe(true); // TV-PG
    expect(await allowed(7, "anilist:show:555")).toBe(false);
  });

  test("a title nobody rates is hidden under a limit", async () => {
    expect(await allowed(17, "anilist:show:999")).toBe(false);
    expect(await filter(null).allowed("u", ref("anilist:show:999"))).toBe(true);
  });

  test("cards are filtered the same way", async () => {
    const cards = ["anilist:show:154587", "anilist:show:777", "anilist:show:999", "anilist:show:555"].map((r) => ({ ref: r }));
    expect((await filter(13).filter("u", cards)).map((c) => c.ref)).toEqual(["anilist:show:154587", "anilist:show:555"]);
    expect((await filter(10).filter("u", cards)).map((c) => c.ref)).toEqual(["anilist:show:555"]);
  });
});

describe("AniList caching", () => {
  afterEach(() => setSystemTime());

  test("the rankings are kept 12 hours; Latest Episodes refreshes hourly on its own", async () => {
    const { startTestServer } = await import("./helpers");
    const server = await startTestServer();
    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body)) as { query: string };
      const kind = query.includes("airingSchedules") ? "latest" : query.includes("trending") ? "rankings" : "list";
      asked.push(kind);
      const page = { media: [linked(1, "TV", "One")] };
      if (kind === "latest") return Response.json({ data: { latest: { airingSchedules: [] } } });
      if (kind === "list") return Response.json({ data: { popular: page } });
      return Response.json({ data: Object.fromEntries(["trending", "season", "airing", "popular", "favourites", "completed", "upcoming"].map((k) => [k, page])) });
    }) as unknown as typeof fetch;
    const start = new Date("2026-10-10T10:05:00Z");
    setSystemTime(start);
    const anilist = new Anilist(server.services.cache, fetchImpl);
    expect((await anilist.home())?.trending).toHaveLength(1);
    await anilist.list("popular");
    expect(asked.sort()).toEqual(["latest", "list", "rankings"]);

    // Within the hour: nothing asked again.
    setSystemTime(new Date(start.getTime() + 30 * 60_000));
    await anilist.home();
    await anilist.list("popular");
    expect(asked).toHaveLength(3);

    // Two hours on: only Latest Episodes is refreshed (behind the stale copy).
    setSystemTime(new Date(start.getTime() + 2 * 3_600_000));
    expect((await anilist.home())?.trending).toHaveLength(1);
    await anilist.list("popular");
    for (let i = 0; i < 200 && asked.length < 4; i++) await Bun.sleep(20);
    await Bun.sleep(50);
    expect(asked.slice(3)).toEqual(["latest"]);
    server.services.shutdown();
  }, 20_000); // AniList's requests are spaced 2s apart
});
