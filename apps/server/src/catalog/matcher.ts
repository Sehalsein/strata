import type { ParsedName } from "../media/parse";
import { type Tmdb, type TmdbListItem, yearOf } from "./tmdb";

export interface MatchResult {
  type: "movie" | "show";
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genreIds?: number[] | null;
}

/** Maps parsed file names to TMDB ids. Results are memoized per (kind, title, year). */
export class Matcher {
  private memo = new Map<string, Promise<MatchResult | null>>();

  constructor(private readonly tmdb: Tmdb) {}

  match(parsed: ParsedName): Promise<MatchResult | null> {
    if (!parsed.title) return Promise.resolve(null);
    const type = parsed.kind === "episode" ? "show" : "movie";
    const key = `${type}|${normalize(parsed.title)}|${parsed.year ?? ""}`;
    let pending = this.memo.get(key);
    if (!pending) {
      pending = this.lookup(type, parsed.title, parsed.year);
      this.memo.set(key, pending);
      // Don't memoize failures (network errors etc.) so the next scan retries.
      pending.catch(() => this.memo.delete(key));
    }
    return pending;
  }

  private async lookup(type: "movie" | "show", title: string, year?: number): Promise<MatchResult | null> {
    const search = (y?: number) => (type === "movie" ? this.tmdb.searchMovie(title, y) : this.tmdb.searchShow(title, y));
    let results = (await search(year)).results;
    if (results.length === 0 && year) results = (await search()).results;
    const best = pickBest(results, title, year);
    if (!best) return null;
    return {
      type,
      tmdbId: best.id,
      title: best.title ?? best.name ?? title,
      year: yearOf(best.release_date ?? best.first_air_date),
      posterPath: best.poster_path ?? null,
      backdropPath: best.backdrop_path ?? null,
      genreIds: best.genre_ids ?? null,
    };
  }
}

export function pickBest(results: TmdbListItem[], title: string, year?: number): TmdbListItem | null {
  const wanted = normalize(title);
  let best: { item: TmdbListItem; score: number } | null = null;
  // TMDB's own ordering (popularity-weighted relevance) is a good tiebreaker.
  results.slice(0, 10).forEach((item, rank) => {
    const name = normalize(item.title ?? item.name ?? "");
    const similarity = name === wanted ? 1 : diceCoefficient(name, wanted);
    if (similarity < 0.6) return;
    const itemYear = yearOf(item.release_date ?? item.first_air_date);
    let score = similarity * 10 - rank * 0.3;
    if (year && itemYear) score += itemYear === year ? 3 : Math.abs(itemYear - year) === 1 ? 1.5 : -3;
    if (!best || score > best.score) best = { item, score };
  });
  return (best as { item: TmdbListItem } | null)?.item ?? null;
}

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  };
  const ab = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ab) overlap += Math.min(n, bb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}
