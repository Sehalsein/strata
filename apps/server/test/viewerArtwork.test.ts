import { describe, expect, test } from "bun:test";
import { Viewer } from "../src/catalog/viewer";
import type { Shelf } from "../src/catalog/service";

const shelves: Shelf[] = [
  {
    id: "addon:x:movie/trending",
    title: "Trending Films",
    kind: "titles",
    items: [
      { type: "movie", ref: "tmdb:movie:1", tmdbId: 1, title: "TMDB's title", year: 2000, posterUrl: "https://image.tmdb.org/1.jpg", backdropUrl: null, available: [], addonPosterUrl: "https://addon.example/1.jpg" },
      { type: "movie", ref: "tmdb:movie:2", tmdbId: 2, title: "Plain", year: 2001, posterUrl: "https://image.tmdb.org/2.jpg", backdropUrl: null, available: [] },
    ],
  },
];

const viewer = (maxAge: number | null) =>
  new Viewer(
    {
      catalog: { homeCatalog: async () => structuredClone(shelves) },
      content: { maxAge: async () => maxAge, filter: async (_: string, cards: unknown[]) => cards },
    } as never,
    "user-1",
  );

describe("an add-on's own posters", () => {
  test("show for a profile without a limit, and never leave as their own field", async () => {
    const [row] = await viewer(null).homeCatalog();
    expect(row!.items.map((i) => i.posterUrl)).toEqual(["https://addon.example/1.jpg", "https://image.tmdb.org/2.jpg"]);
    expect(row!.items[0]).not.toHaveProperty("addonPosterUrl");
  });

  test("under a content limit, every card shows TMDB's", async () => {
    const [row] = await viewer(12).homeCatalog();
    expect(row!.items.map((i) => i.posterUrl)).toEqual(["https://image.tmdb.org/1.jpg", "https://image.tmdb.org/2.jpg"]);
    expect(row!.items[0]).not.toHaveProperty("addonPosterUrl");
  });
});
