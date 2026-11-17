import { describe, expect, test } from "bun:test";
import { tasteSeeds, topPicks } from "../src/catalog/forYou";

const DAY = 86_400_000;
const now = 1_000 * DAY;
const play = (over: Partial<Parameters<typeof tasteSeeds>[0][number]>) => ({ mediaType: "movie" as const, source: "tmdb", titleId: 1, positionMs: 0, durationMs: 6_000_000, completed: false, updatedAt: now, ...over });

describe("taste", () => {
  test("finished films and well-watched shows count most; old plays fade; AniList and barely-started ones don't count", () => {
    const seeds = tasteSeeds(
      [
        play({ titleId: 10, completed: true }),
        play({ titleId: 11, completed: true, updatedAt: now - 90 * DAY }),
        play({ titleId: 12, positionMs: 2_500_000 }),
        play({ titleId: 13, positionMs: 60_000 }),
        ...[1, 2, 3, 4, 5, 6].map((e) => play({ mediaType: "episode", titleId: 20, completed: true, updatedAt: now - e })),
        play({ titleId: 30, source: "anilist", completed: true }),
      ],
      [{ source: "tmdb", type: "show", titleId: 40, addedAt: now }],
      now,
    );
    expect(seeds.map((s) => `${s.type}:${s.id}`)).toEqual(["show:20", "movie:10", "movie:12", "show:40", "movie:11"]);
    expect(seeds[0]!.weight).toBeCloseTo(4, 3);
    expect(seeds.at(-1)!.weight).toBeCloseTo(3 / 4, 2);
  });
});

describe("top picks", () => {
  test("titles several seeds recommend rise; seen ones are left out", () => {
    const picks = topPicks(
      [
        { seed: { type: "movie", id: 1, weight: 3 }, recs: [{ type: "movie", id: 100 }, { type: "movie", id: 101 }, { type: "movie", id: 102 }] },
        { seed: { type: "movie", id: 2, weight: 1 }, recs: [{ type: "movie", id: 102 }, { type: "movie", id: 103 }, { type: "movie", id: 100 }] },
      ],
      new Set(["movie:101"]),
    );
    expect(picks.map((p) => p.id)).toEqual([100, 102, 103]);
  });
});
