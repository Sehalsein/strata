import type { TitleType } from "./service";

/**
 * "For you" on Home, from what each person watches in Strata (no outside service): their
 * taste is the titles they finished or watched most of, recent ones counting more; for the
 * strongest of those, TMDB's recommendations are pooled into "Top picks for you", and the
 * two strongest get "Because you watched …" rows. Pure: the catalog fetches and draws.
 */

/** A movie or show (TMDB's), with how much it says about the person's taste. */
export interface Seed {
  type: TitleType;
  id: number;
  weight: number;
}

/** One play record, as far as taste cares (a movie, or an episode of a show). */
export interface Watched {
  mediaType: "movie" | "episode";
  source: string;
  titleId: number;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  updatedAt: number;
}

/** How many titles taste is drawn from, and how fast an old one fades (half its weight in this long). */
const MAX_SEEDS = 8;
const HALF_LIFE_DAYS = 45;

/**
 * The person's strongest titles, strongest first. A finished film counts 3, one watched
 * past a third 1.5; a show counts 1 plus half a point per finished episode (up to 4); a
 * title on My List counts 1. Older plays fade. Only TMDB titles (AniList's have no TMDB
 * recommendations).
 */
export function tasteSeeds(history: Watched[], listed: { source: string; type: TitleType; titleId: number; addedAt: number }[], now = Date.now()): Seed[] {
  const fade = (at: number) => Math.pow(0.5, Math.max(0, now - at) / (HALF_LIFE_DAYS * 86_400_000));
  const seeds = new Map<string, Seed & { at: number }>();
  const add = (type: TitleType, id: number, weight: number, at: number) => {
    const key = `${type}:${id}`;
    const s = seeds.get(key) ?? { type, id, weight: 0, at };
    s.weight += weight;
    s.at = Math.max(s.at, at);
    seeds.set(key, s);
  };
  const episodes = new Map<number, { done: number; at: number }>();
  for (const h of history) {
    if (h.source !== "tmdb") continue;
    if (h.mediaType === "movie") {
      const share = h.durationMs > 0 ? h.positionMs / h.durationMs : 0;
      const weight = h.completed ? 3 : share >= 1 / 3 ? 1.5 : 0;
      if (weight) add("movie", h.titleId, weight * fade(h.updatedAt), h.updatedAt);
      continue;
    }
    const e = episodes.get(h.titleId) ?? { done: 0, at: 0 };
    if (h.completed) e.done++;
    e.at = Math.max(e.at, h.updatedAt);
    episodes.set(h.titleId, e);
  }
  for (const [id, e] of episodes) add("show", id, Math.min(1 + e.done * 0.5, 4) * fade(e.at), e.at);
  for (const l of listed) if (l.source === "tmdb") add(l.type, l.titleId, 1 * fade(l.addedAt), l.addedAt);
  return [...seeds.values()]
    .filter((s) => s.weight > 0.05)
    .sort((a, b) => b.weight - a.weight || b.at - a.at)
    .slice(0, MAX_SEEDS)
    .map(({ type, id, weight }) => ({ type, id, weight }));
}

/** A recommendation, as TMDB lists them (the movie's or show's own type). */
export interface Rec {
  type: TitleType;
  id: number;
  /** TMDB's rating out of 10, when known: better-liked titles rise. */
  rating?: number;
}

/** How a recommendation weighs: higher in TMDB's list, and better liked, counts more. */
export const recScore = (rank: number, rating?: number) => (1 / (1 + rank * 0.15)) * Math.pow((rating ?? 6.5) / 10, 3);

/** One seed's recommendations, best first by recScore. */
export const bestFirst = (recs: Rec[]): Rec[] =>
  recs
    .map((r, rank) => ({ r, s: recScore(rank, r.rating) }))
    .sort((a, b) => b.s - a.s)
    .map(({ r }) => r);

/**
 * Pools the seeds' recommendations: each scores its seed's weight, more for TMDB's higher
 * picks; titles several seeds recommend rise. `seen` (watched, in progress, on My List, the
 * seeds themselves) is left out.
 */
export function topPicks(recsBySeed: { seed: Seed; recs: Rec[] }[], seen: Set<string>, limit = 20): Rec[] {
  const score = new Map<string, { rec: Rec; score: number; first: number }>();
  let order = 0;
  for (const { seed, recs } of recsBySeed) {
    recs.forEach((rec, rank) => {
      const key = `${rec.type}:${rec.id}`;
      if (seen.has(key)) return;
      const s = score.get(key) ?? { rec, score: 0, first: order++ };
      s.score += seed.weight * recScore(rank, rec.rating);
      score.set(key, s);
    });
  }
  return [...score.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, limit)
    .map((s) => s.rec);
}
