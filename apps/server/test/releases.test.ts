import { expect, test } from "bun:test";
import { CatalogService } from "../src/catalog/service";
import type { Tmdb, TmdbListItem } from "../src/catalog/tmdb";

const film = (id: number, release_date: string, popularity: number): TmdbListItem => ({ id, title: `Film ${id}`, release_date, popularity, poster_path: "/p.jpg" });
const library = { availability: async () => new Map() } as never;
const settings = () => ({ region: "GB" }) as never;

test("Latest Releases: digital releases of the last 60 days in the region, newest first, without obscure ones", async () => {
  const asked: Record<string, string>[] = [];
  const tmdb = {
    discover: async (_type: string, params: Record<string, string>) => {
      asked.push(params);
      // Page 2 repeats a film from page 1, as TMDB's pages can while they shift.
      return { results: params.page === "1" ? [film(1, "2026-10-30", 120), film(2, "2026-10-29", 3)] : params.page === "2" ? [film(1, "2026-10-30", 120), film(3, "2026-10-20", 45)] : [] };
    },
  } as unknown as Tmdb;
  const cards = await new CatalogService(tmdb, library, {} as never, settings).browse("movie", "latestReleases");
  expect(cards.map((c) => c.tmdbId)).toEqual([1, 3]);
  expect(asked[0]).toMatchObject({ region: "GB", with_release_type: "4", sort_by: "release_date.desc", "with_runtime.gte": "60" });
  // A film first out over a year ago is a re-release, not a new one.
  expect(asked[0]!["primary_release_date.gte"]! < asked[0]!["release_date.gte"]!).toBe(true);
  expect(asked.map((p) => p.page)).toEqual(["1", "2", "3"]);
});

test("New in Theaters: what's playing in the region's cinemas, newest release first", async () => {
  const regions: string[] = [];
  const tmdb = {
    nowPlaying: async (region: string, page: number) => {
      regions.push(region);
      return { results: page === 1 ? [film(10, "2026-10-16", 90), film(11, "2026-10-30", 150), film(12, "2026-10-23", 2)] : page === 2 ? [film(13, "2026-10-23", 1453)] : [] };
    },
  } as unknown as Tmdb;
  const cards = await new CatalogService(tmdb, library, {} as never, settings).browse("movie", "inTheaters");
  expect(cards.map((c) => c.tmdbId)).toEqual([11, 13, 10]);
  expect(regions).toEqual(["GB", "GB", "GB"]);
});

test("the release lists are films only", async () => {
  const service = new CatalogService({} as Tmdb, library, {} as never, settings);
  expect(await service.browse("show", "latestReleases")).toEqual([]);
  expect(await service.browse("show", "inTheaters")).toEqual([]);
});
