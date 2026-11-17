import { describe, expect, test } from "bun:test";
import { TitleIds } from "../src/catalog/titleIds";
import { AnimeIds } from "../src/catalog/anime/ids";
import { keepCatalogChoices } from "../src/sources/addons";

describe("other sites' ids as Strata's titles", () => {
  const finds: string[] = [];
  const tmdb = {
    find: async (id: string, source: string) => {
      finds.push(`${source}:${id}`);
      if (id === "tt0111161") return { movie_results: [{ id: 278 }], tv_results: [] };
      if (id === "81189") return { movie_results: [], tv_results: [{ id: 1396 }] };
      return { movie_results: [], tv_results: [] };
    },
  } as never;
  const anime = new AnimeIds({ load: async () => null, save: async () => {} } as never);
  anime.index([
    { anilist_id: 21, kitsu_id: 12, mal_id: 21, themoviedb_id: 37854, type: "TV" },
    { anilist_id: 999, kitsu_id: 55, mal_id: 77, type: "TV" },
  ] as never);
  anime.ready = async () => {};
  const ids = new TitleIds(tmdb, anime);

  test("each kind of id lands on the right title", async () => {
    expect(await ids.resolve("tt0111161", "movie")).toEqual({ source: "tmdb", type: "movie", id: 278 });
    expect(await ids.resolve("tmdb:550", "movie")).toEqual({ source: "tmdb", type: "movie", id: 550 });
    expect(await ids.resolve("tmdb:tv:1399", "movie")).toEqual({ source: "tmdb", type: "show", id: 1399 });
    expect(await ids.resolve("tvdb:81189", "show")).toEqual({ source: "tmdb", type: "show", id: 1396 });
    // Anime: TMDB's title where the anime list has one, else AniList's.
    expect(await ids.resolve("kitsu:12", "show")).toEqual({ source: "tmdb", type: "show", id: 37854 });
    expect(await ids.resolve("mal:21", "show")).toEqual({ source: "tmdb", type: "show", id: 37854 });
    expect(await ids.resolve("mal:77", "show")).toEqual({ source: "anilist", type: "show", id: 999 });
  });

  test("unknown ids are null, and each id is looked up once", async () => {
    expect(await ids.resolve("tt0000001", "movie")).toBeNull();
    expect(await ids.resolve("xyz:1", "movie")).toBeNull();
    expect(await ids.resolve("tt0111161; drop", "movie")).toBeNull();
    const before = finds.length;
    await ids.resolve("tt0111161", "movie");
    expect(finds.length).toBe(before);
  });
});

describe("an add-on's catalogs read again", () => {
  test("keep what was on Home; new ones start off", () => {
    const before = [
      { type: "movie" as const, id: "a", name: "A", home: false },
      { type: "movie" as const, id: "b", name: "B", home: true },
    ];
    const fresh = [
      { type: "movie" as const, id: "a", name: "A", home: true },
      { type: "movie" as const, id: "b", name: "B renamed", home: false },
      { type: "series" as const, id: "c", name: "C", home: true },
    ];
    expect(keepCatalogChoices(fresh, before).map((c) => [c.id, c.name, c.home])).toEqual([
      ["a", "A", false],
      ["b", "B renamed", true],
      ["c", "C", false],
    ]);
  });
});
