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
  { type: "MOVIE", anilist_id: 21519, kitsu_id: 11614, themoviedb_id: { movie: 372058 } }, // Your Name.
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
