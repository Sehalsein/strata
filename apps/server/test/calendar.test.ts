import { describe, expect, test } from "bun:test";
import { CalendarService } from "../src/catalog/calendar";
import type { TitleRef } from "../src/catalog/ref";
import { AnimeIds, fileAnimeIdStore } from "../src/catalog/anime/ids";
import type { Anilist, AiringEpisode } from "../src/catalog/anime/anilist";
import type { Tmdb, TmdbSeason, TmdbShow } from "../src/catalog/tmdb";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const DAY = 86_400;
const at = (iso: string) => Date.parse(iso) / 1000;

const show = (id: number, name: string, seasons: [number, number][], next?: number): TmdbShow =>
  ({ id, name, genres: [], poster_path: "/p.jpg", backdrop_path: null, seasons: seasons.map(([n, count]) => ({ season_number: n, name: `S${n}`, episode_count: count })), next_episode_to_air: next ? { season_number: next, episode_number: 1 } : null }) as TmdbShow;
const season = (n: number, episodes: [number, string][]): TmdbSeason => ({ id: n, season_number: n, name: `S${n}`, episodes: episodes.map(([e, date]) => ({ id: e, season_number: n, episode_number: e, name: `Episode ${e}`, air_date: date })) });

const SHOWS: Record<number, TmdbShow> = {
  1: show(1, "The Drama", [[1, 8], [2, 8]]),
  209867: show(209867, "Frieren", [[1, 38]]),
  3: show(3, "Old Show", [[1, 10]]),
  // Season 2 is announced for next spring.
  7: { ...show(7, "Returning Show", [[1, 8]]), next_episode_to_air: { season_number: 2, episode_number: 1, air_date: "2027-03-04" } } as TmdbShow,
};
const SEASONS: Record<string, TmdbSeason> = {
  "1:2": season(2, [[1, "2026-10-20"], [2, "2026-10-27"], [3, "2026-11-03"], [4, "2026-12-30"]]),
  "209867:1": season(1, [[30, "2026-10-24"], [31, "2026-10-31"]]),
  "3:1": season(1, [[1, "2019-01-01"]]),
};
const tmdb = {
  show: async (id: number) => SHOWS[id] ?? Promise.reject(new Error("404")),
  season: async (id: number, n: number) => SEASONS[`${id}:${n}`] ?? Promise.reject(new Error("404")),
} as unknown as Tmdb;

function service(watchlist: number[], airing: AiringEpisode[], inLibrary: string[] = [], allowed: (id: number) => boolean = () => true) {
  const ids = new AnimeIds(fileAnimeIdStore("/nonexistent"));
  // Frieren S2 (AniList 182255) is TMDB S1 from episode 29.
  ids.index([
    { type: "TV", anilist_id: 154587, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 } },
    { type: "TV", anilist_id: 182255, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 }, episode_offset: { tmdb: 28 } },
  ]);
  ids.ready = async () => {};
  const asked: { ids: number[]; from: number; to: number }[] = [];
  const anilist = { airing: async (mediaIds: number[], from: number, to: number) => (asked.push({ ids: mediaIds, from, to }), airing) } as unknown as Anilist;
  const library = { filesFor: (show: TitleRef, s: number, e: number) => (inLibrary.includes(`${show.id}:${s}:${e}`) ? [{}] : []) } as never;
  const progress = { history: async () => [], reminders: async () => [], watchlist: () => watchlist.map((titleId) => ({ source: "tmdb", type: "show", titleId })) } as never;
  return { calendar: new CalendarService(tmdb, library, progress, { ids, anilist }, async (_, show) => allowed(show.id)), asked };
}

describe("calendar", () => {
  test("TV from TMDB air dates and anime from AniList times, in order, within the last week and next month", async () => {
    const { calendar, asked } = service([1, 209867, 3], [
      { mediaId: 182255, episode: 2, airingAt: at("2026-10-24T15:00:00Z") },
      { mediaId: 182255, episode: 3, airingAt: at("2026-10-31T15:00:00Z") },
      { mediaId: 182255, episode: 4, airingAt: at("2026-11-07T15:00:00Z") },
    ], ["1:2:2"]);
    const items = await calendar.episodes("u1", NOW);
    // Episode 1 (Oct 20) is more than a week ago, episode 4 (Dec 30) more than a month ahead.
    expect(items.map((i) => [i.title, i.season, i.episode, i.airDate, i.airsAt])).toEqual([
      ["Frieren", 1, 30, "2026-10-24", "2026-10-24T15:00:00.000Z"],
      ["The Drama", 2, 2, "2026-10-27", null],
      ["Frieren", 1, 31, "2026-10-31", "2026-10-31T15:00:00.000Z"],
      ["The Drama", 2, 3, "2026-11-03", null],
      // Not in TMDB's season yet: no TMDB numbering, but still on the calendar.
      ["Frieren", null, 32, "2026-11-07", "2026-11-07T15:00:00.000Z"],
    ]);
    expect(items.find((i) => i.episode === 2)!.available).toBe(true);
    expect(items.find((i) => i.episode === 30)!.name).toBe("Episode 30");
    // Only the anime asks AniList, for the whole window in one request.
    expect(asked).toEqual([{ ids: [154587, 182255], from: at("2026-10-22T00:00:00Z"), to: at("2026-10-29T00:00:00Z") + 31 * DAY }]);
  });

  test("shows above the profile's content limit stay off its calendar, without being looked up", async () => {
    const { calendar, asked } = service([1, 209867], [{ mediaId: 182255, episode: 3, airingAt: at("2026-10-31T15:00:00Z") }], [], (id) => id !== 209867);
    const items = await calendar.episodes("u1", NOW);
    expect(new Set(items.map((i) => i.title))).toEqual(new Set(["The Drama"]));
    expect(asked).toEqual([]);
  });

  test("an empty list, or shows TMDB can't find, make an empty calendar", async () => {
    expect(await service([], []).calendar.episodes("u1", NOW)).toEqual([]);
    expect(await service([404], []).calendar.episodes("u1", NOW)).toEqual([]);
  });
});

test("AniList shows on the list come from AniList's schedule, numbered as AniList numbers them", async () => {
  const ids = new AnimeIds(fileAnimeIdStore("/nonexistent"));
  ids.index([{ type: "TV", anilist_id: 182255, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 }, episode_offset: { tmdb: 28 } }]);
  ids.ready = async () => {};
  const asked: number[][] = [];
  const anilist = {
    airing: async (mediaIds: number[]) => (asked.push(mediaIds), [{ mediaId: 182255, episode: 3, airingAt: at("2026-10-31T15:00:00Z") }, { mediaId: 888, episode: 9, airingAt: at("2026-11-01T15:00:00Z") }]),
    title: async (id: number) => ({ id, title: { romaji: id === 888 ? "Adult Thing" : "Sousou no Frieren 2nd Season" }, isAdult: id === 888, coverImage: { large: `https://img.anili.st/${id}.jpg` }, bannerImage: null }),
  } as unknown as Anilist;
  const library = { filesFor: (show: TitleRef, s: number, e: number) => (show.source === "anilist" && show.id === 182255 && s === 1 && e === 3 ? [{}] : []) } as never;
  const progress = { history: async () => [], reminders: async () => [], watchlist: () => [{ source: "anilist", type: "show", titleId: 182255 }, { source: "anilist", type: "show", titleId: 888 }, { source: "anilist", type: "show", titleId: 4 }] } as never;
  const allowed: TitleRef[] = [];
  const calendar = new CalendarService(tmdb, library, progress, { ids, anilist }, async (_, show) => (allowed.push(show), show.id !== 4));
  const items = await calendar.episodes("u1", NOW);
  expect(items).toEqual([
    { ref: "anilist:show:182255", tmdbId: 209867, title: "Sousou no Frieren 2nd Season", posterUrl: "https://img.anili.st/182255.jpg", backdropUrl: null, season: 1, episode: 3, name: null, airsAt: "2026-10-31T15:00:00.000Z", airDate: "2026-10-31", available: true },
  ]);
  // The profile's limit is asked by ref; titles above it aren't looked up.
  expect(allowed.map((r) => r.id)).toEqual([182255, 888, 4]);
  expect(asked).toEqual([[182255, 888]]);
});

describe("calendar entries (ItsOut-style)", () => {
  const film = {
    id: 50,
    title: "The Film",
    poster_path: "/f.jpg",
    backdrop_path: null,
    genres: [],
    release_dates: {
      results: [
        { iso_3166_1: "GB", release_dates: [{ type: 3, certification: "", release_date: "2026-10-23T00:00:00.000Z" }, { type: 4, certification: "", release_date: "2026-11-20T00:00:00.000Z" }, { type: 5, certification: "", release_date: "2027-02-10T00:00:00.000Z" }] },
        { iso_3166_1: "US", release_dates: [{ type: 3, certification: "", release_date: "2026-10-01T00:00:00.000Z" }] },
      ],
    },
  };
  const make = (opts: { inLibrary?: string[]; readyElsewhere?: string[]; reminders?: { source: string; type: string; titleId: number }[] } = {}) => {
    const ids = new AnimeIds(fileAnimeIdStore("/nonexistent"));
    ids.ready = async () => {};
    const anilist = { airing: async () => [] } as unknown as Anilist;
    const library = {
      filesFor: (show: TitleRef, s: number, e: number) => ((opts.inLibrary ?? []).includes(`${show.id}:${s}:${e}`) ? [{}] : []),
      availability: async () => new Map(),
    } as never;
    // The Drama isn't on the list: it's followed because it's being watched.
    const progress = {
      reminders: async () => opts.reminders ?? [],
      history: async () => [{ mediaType: "episode", source: "tmdb", titleId: 1, season: 2, episode: 1, updatedAt: NOW - 3 * DAY * 1000 }],
      watchlist: () => [{ source: "tmdb", type: "movie", titleId: 50 }],
    } as never;
    const t = { ...tmdb, movie: async (id: number) => (id === 50 ? film : Promise.reject(new Error("404"))) } as unknown as Tmdb;
    return new CalendarService(t, library, progress, { ids, anilist }, async () => true, () => "GB", async ({ ref, season, episode }) => (opts.readyElsewhere ?? []).includes(`${ref.id}:${season ?? ""}:${episode ?? ""}`));
  };

  test("shows being watched are followed; films on the list come in with their releases in the household's region", async () => {
    const { entries } = await make().entries("u1", NOW);
    expect(entries.map((e) => [e.kind, e.title, e.label, e.date])).toEqual([
      ["movie", "The Film", "In cinemas", "2026-10-23"],
      ["episode", "The Drama", "S2 E2 · Episode 2", "2026-10-27"],
      ["episode", "The Drama", "S2 E3 · Episode 3", "2026-11-03"],
      ["movie", "The Film", "Out to stream or rent", "2026-11-20"],
    ]);
    expect(entries[3]!.alert).toEqual({ title: "The Film", body: "The Film is out to stream or rent today." });
    expect(entries[1]!.alert!.body).toBe("S2 E2 · Episode 2 airs today.");
    expect(entries[1]!.play).toEqual({ season: 2, episode: 2 });
  });

  test("out and playable is ready: from the library, or ready elsewhere for recent ones, with a ready-to-play note", async () => {
    const { entries } = await make({ readyElsewhere: ["1:2:2"] }).entries("u1", NOW);
    const ep = entries.find((e) => e.label.startsWith("S2 E2"))!;
    expect(ep.ready).toBe(true);
    expect(ep.alert).toEqual({ title: "The Drama", body: "S2 E2 · Episode 2 of The Drama is ready to play in Strata.", now: true });
    // Not out yet: never ready.
    expect(entries.find((e) => e.label.startsWith("S2 E3"))!.ready).toBe(false);
  });

  test("reminded titles come in up to a year ahead, one entry for a show's next premiere, with its notification", async () => {
    const { entries } = await make({ reminders: [{ source: "tmdb", type: "movie", titleId: 50 }, { source: "tmdb", type: "show", titleId: 7 }] }).entries("u1", NOW);
    const later = entries.filter((e) => e.date > "2026-12-01").map((e) => [e.kind, e.title, e.label, e.date]);
    expect(later).toEqual([
      ["movie", "The Film", "Out on disc", "2027-02-10"],
      ["episode", "Returning Show", "Season 2 premieres", "2027-03-04"],
    ]);
    expect(entries.find((e) => e.title === "Returning Show")!.alert).toEqual({ title: "Returning Show", body: "Returning Show season 2 premieres today." });
    // Not reminded: the calendar keeps to its month.
    expect((await make().entries("u1", NOW)).entries.some((e) => e.date > "2026-12-01")).toBe(false);
  });
});
