import { expect, test } from "bun:test";
import { anilistUpcoming, movieUpcoming, remindOf, showUpcoming } from "../src/catalog/upcoming";

const TODAY = "2026-11-16";
const NOW = Date.parse("2026-11-16T12:00:00Z");

test("a film's next release in the region, else the US, else its release date", () => {
  const film = { release_date: "2026-12-20", release_dates: { results: [{ iso_3166_1: "GB", release_dates: [{ type: 3, certification: "", release_date: "2026-10-01T00:00:00Z" }, { type: 4, certification: "", release_date: "2027-01-05T00:00:00Z" }] }] } };
  expect(movieUpcoming(film, "gb", TODAY)).toMatchObject({ date: "2027-01-05", label: "Out to stream or rent" });
  expect(movieUpcoming({ release_date: "2026-12-20" }, "GB", TODAY)).toMatchObject({ date: "2026-12-20", label: "Out" });
  expect(movieUpcoming({ release_date: "2020-01-01" }, "GB", TODAY)).toBeNull();
});

test("a show's next premiere: a new season or its first air date, never an episode mid-season", () => {
  expect(showUpcoming({ next_episode_to_air: { season_number: 3, episode_number: 1, air_date: "2027-01-01" } }, TODAY)!.label).toBe("Season 3 premieres");
  expect(showUpcoming({ next_episode_to_air: { season_number: 1, episode_number: 4, air_date: "2026-11-20" } }, TODAY)).toBeNull();
  expect(showUpcoming({ next_episode_to_air: null, first_air_date: "2027-04-01" }, TODAY)).toMatchObject({ date: "2027-04-01", label: "Premieres" });
  expect(showUpcoming({ next_episode_to_air: null, first_air_date: "2010-01-01" }, TODAY)).toBeNull();
});

test("AniList: the first episode's airing with its time, or a start date still to come", () => {
  const at = Date.parse("2026-11-20T15:00:00Z") / 1000;
  expect(anilistUpcoming({ nextAiringEpisode: { episode: 1, airingAt: at } }, "show", NOW)).toEqual({ date: "2026-11-20", airsAt: "2026-11-20T15:00:00.000Z", label: "Premieres", out: "premieres today" });
  expect(anilistUpcoming({ nextAiringEpisode: { episode: 5, airingAt: at } }, "show", NOW)).toBeNull();
  expect(anilistUpcoming({ startDate: { year: 2027, month: 1, day: 9 } }, "movie", NOW)).toMatchObject({ date: "2027-01-09", label: "Out" });
  // Only a year or month known: nothing to notify on.
  expect(anilistUpcoming({ startDate: { year: 2027, month: 1 } }, "show", NOW)).toBeNull();
});

test("a reminder that's on is always offered, so it can be turned off once its date has passed", () => {
  expect(remindOf(null, false)).toBeNull();
  expect(remindOf(null, true)).toEqual({ on: true, date: null, airsAt: null, label: null });
  expect(remindOf({ date: "2027-01-01", airsAt: null, label: "Premieres", out: "premieres today" }, false)).toEqual({ on: false, date: "2027-01-01", airsAt: null, label: "Premieres" });
});
