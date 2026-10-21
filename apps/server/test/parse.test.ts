import { describe, expect, test } from "bun:test";
import { isVideoFile, parseFileName, parseMediaPath } from "../src/media/parse";
import { Matcher, pickBest } from "../src/catalog/matcher";

describe("parseFileName", () => {
  test("scene movie", () => {
    const p = parseFileName("Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.7.1.Atmos-FGT.mkv");
    expect(p).toMatchObject({ kind: "movie", title: "Dune Part Two", year: 2024, resolution: 2160, source: "remux", videoCodec: "hevc", hdr: "dv", group: "FGT" });
  });

  test("plex-style movie", () => {
    expect(parseFileName("The Matrix (1999).mp4")).toMatchObject({ kind: "movie", title: "The Matrix", year: 1999 });
  });

  test("numeric titles keep their name", () => {
    expect(parseFileName("1917.2019.1080p.WEB-DL.x264.mkv")).toMatchObject({ title: "1917", year: 2019, resolution: 1080, source: "web", videoCodec: "h264" });
    expect(parseFileName("2012 (2009).mkv")).toMatchObject({ title: "2012", year: 2009 });
  });

  test("scene episode", () => {
    const p = parseFileName("Severance.S02E05.Trojans.Horse.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb.mkv");
    expect(p).toMatchObject({ kind: "episode", title: "Severance", season: 2, episode: 5, resolution: 1080, source: "web" });
  });

  test("multi-episode and NxNN forms", () => {
    expect(parseFileName("Friends.S01E01E02.720p.mkv")).toMatchObject({ season: 1, episode: 1, episodeEnd: 2, title: "Friends" });
    expect(parseFileName("Friends - 3x07 - The One.avi")).toMatchObject({ season: 3, episode: 7, title: "Friends" });
  });

  test("show with year", () => {
    expect(parseFileName("Doctor Who (2005) - S01E01 - Rose.mkv")).toMatchObject({ title: "Doctor Who", year: 2005, season: 1, episode: 1 });
  });
});

describe("parseMediaPath", () => {
  test("season folders supply show title", () => {
    const p = parseMediaPath(["Breaking Bad (2008)", "Season 2", "03 - Bit by a Dead Bee.mkv"]);
    expect(p).toMatchObject({ kind: "episode", title: "Breaking Bad", year: 2008, season: 2, episode: 3 });
  });

  test("bare SxxEyy file inside show folder", () => {
    const p = parseMediaPath(["The Bear", "Season 01", "S01E04.mkv"]);
    expect(p).toMatchObject({ kind: "episode", title: "The Bear", season: 1, episode: 4 });
  });

  test("generic movie file inside named folder", () => {
    expect(parseMediaPath(["Heat (1995)", "movie.mkv"])).toMatchObject({ kind: "movie", title: "Heat", year: 1995 });
  });

  test("torrent folder for season pack", () => {
    const p = parseMediaPath(["Shogun.2024.S01.1080p.WEB", "Shogun.2024.S01E03.Tomorrow.Is.Tomorrow.1080p.mkv"]);
    expect(p).toMatchObject({ kind: "episode", title: "Shogun", year: 2024, season: 1, episode: 3 });
  });
});

test("isVideoFile skips samples and non-video", () => {
  expect(isVideoFile("Movie.2020.mkv")).toBe(true);
  expect(isVideoFile("Movie.2020.sample.mkv")).toBe(false);
  expect(isVideoFile("Movie.2020.nfo")).toBe(false);
});

describe("names that used to go unmatched", () => {
  test("a scene release with a [tag] in front isn't read as anime", () => {
    expect(parseFileName("[HMXT]Spiderman.3.HDRip.Ac3.[www.hermeticos.org].avi")).toMatchObject({ kind: "movie", title: "Spiderman 3" });
    expect(parseFileName("[HMXT]Spiderman.3.HDRip.Ac3.[www.hermeticos.org].avi").anime).toBeUndefined();
  });
});

describe("matching titles", () => {
  test("non-Latin titles match TMDB's original title", () => {
    const results = [{ id: 1, title: "The Cliff", original_title: "Утёс", release_date: "2026-03-01" }];
    expect(pickBest(results, "Утёс", 2026)?.id).toBe(1);
  });

  test("a non-Latin name found through a translation takes TMDB's top hit of that year", async () => {
    const tmdb = { searchMovie: async () => ({ results: [{ id: 799882, title: "The Bluff", original_title: "The Bluff", release_date: "2026-02-25" }] }) };
    expect((await new Matcher(tmdb as never).match(parseFileName("Утёс.2026.WEB-DLRip-AVC.x264.seleZen.mkv")))?.tmdbId).toBe(799882);
  });

  test("a studio name before the title is dropped when the year confirms it", async () => {
    const ironMan = { id: 1726, title: "Iron Man", release_date: "2008-04-30" };
    const tmdb = { searchMovie: async (q: string) => ({ results: q === "Iron Man" ? [ironMan] : [] }) };
    const matcher = new Matcher(tmdb as never);
    expect((await matcher.match(parseFileName("Marvel Studios Iron Man 2008 1080p MA WEB-DL DDP5 1 H 264-SARVO.mkv")))?.tmdbId).toBe(1726);
  });
});
