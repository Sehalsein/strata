import { describe, expect, test } from "bun:test";
import { CalendarService } from "../src/catalog/calendar";
import { AnimeIds } from "../src/catalog/anime/ids";
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
  const ids = new AnimeIds("/nonexistent");
  // Frieren S2 (AniList 182255) is TMDB S1 from episode 29.
  ids.index([
    { type: "TV", anilist_id: 154587, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 } },
    { type: "TV", anilist_id: 182255, themoviedb_id: { tv: 209867 }, season: { tmdb: 1 }, episode_offset: { tmdb: 28 } },
  ]);
  ids.ready = async () => {};
  const asked: { ids: number[]; from: number; to: number }[] = [];
  const anilist = { airing: async (mediaIds: number[], from: number, to: number) => (asked.push({ ids: mediaIds, from, to }), airing) } as unknown as Anilist;
  const library = { filesFor: (_: string, id: number, s: number, e: number) => (inLibrary.includes(`${id}:${s}:${e}`) ? [{}] : []) } as never;
  const progress = { watchlist: () => watchlist.map((tmdbId) => ({ type: "show", tmdbId })) } as never;
  return { calendar: new CalendarService(tmdb, library, progress, { ids, anilist }, async (_, id) => allowed(id)), asked };
}

describe("calendar", () => {
  test("TV from TMDB air dates and anime from AniList times, in order, within the last week and next month", async () => {
    const { calendar, asked } = service([1, 209867, 3], [
      { mediaId: 182255, episode: 2, airingAt: at("2026-10-24T15:00:00Z") },
      { mediaId: 182255, episode: 3, airingAt: at("2026-10-31T15:00:00Z") },
      { mediaId: 182255, episode: 4, airingAt: at("2026-11-07T15:00:00Z") },
    ], ["1:2:2"]);
    const items = await calendar.episodes(1, NOW);
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
    const items = await calendar.episodes(1, NOW);
    expect(new Set(items.map((i) => i.title))).toEqual(new Set(["The Drama"]));
    expect(asked).toEqual([]);
  });

  test("an empty list, or shows TMDB can't find, make an empty calendar", async () => {
    expect(await service([], []).calendar.episodes(1, NOW)).toEqual([]);
    expect(await service([404], []).calendar.episodes(1, NOW)).toEqual([]);
  });
});
