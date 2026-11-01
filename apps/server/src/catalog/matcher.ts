import type { ParsedName } from "../media/parse";
import type { AnimeMatcher } from "./anime/match";
import { type Tmdb, type TmdbListItem, yearOf } from "./tmdb";
import { SharedWork } from "../inFlight";
import type { TitleSource } from "./ref";

export interface MatchResult {
  /** TMDB for movies and TV, AniList for anime. */
  source: TitleSource;
  type: "movie" | "show";
  /** The title's id at `source`. */
  titleId: number;
  title: string;
  year: number | null;
  /** TMDB's image path, or a full URL (AniList's cover). */
  posterPath: string | null;
  backdropPath: string | null;
  /** TMDB's genre ids (TMDB titles only). */
  genreIds?: number[] | null;
  /** The source's numbering when it differs from the file's (anime: the AniList entry's own episode). */
  season?: number;
  episode?: number;
}

/**
 * Maps parsed file names to titles: anime to AniList, everything else to TMDB. TMDB
 * results are memoized per (kind, title, year).
 */
export class Matcher {
  private memo = new SharedWork<string, MatchResult | null>({ remember: true, max: 5_000 });

  constructor(
    private readonly tmdb: Tmdb,
    private readonly anime?: AnimeMatcher,
  ) {}

  async match(parsed: ParsedName): Promise<MatchResult | null> {
    // Anime names go to AniList (their titles are usually romaji, their episodes may be
    // absolute), and to a TMDB title search only when AniList finds nothing. AniList being
    // down throws, so the file waits for the next run instead of matching to TMDB.
    if (parsed.anime && this.anime) {
      const anime = await this.anime.match(parsed);
      if (anime) return anime;
    }
    return this.matchTitle(parsed);
  }

  private matchTitle(parsed: ParsedName): Promise<MatchResult | null> {
    if (!parsed.title) return Promise.resolve(null);
    const type = parsed.kind === "episode" ? "show" : "movie";
    const key = `${type}|${normalize(parsed.title)}|${parsed.year ?? ""}`;
    // Failures (network errors etc.) aren't kept, so the next scan retries.
    return this.memo.get(key, () => this.lookup(type, parsed.title!, parsed.year));
  }

  private async lookup(type: "movie" | "show", title: string, year?: number): Promise<MatchResult | null> {
    const search = (y?: number) => (type === "movie" ? this.tmdb.searchMovie(title, y) : this.tmdb.searchShow(title, y));
    let results = (await search(year)).results;
    if (results.length === 0 && year) results = (await search()).results;
    let best = pickBest(results, title, year);
    // A non-Latin name ("Утёс") is often found through a translation, so neither of
    // TMDB's titles looks like it: trust the top hit when its year agrees.
    if (!best && year && /\p{L}/u.test(title) && !/\p{Script=Latin}/u.test(title)) {
      const top = results[0];
      if (top && yearOf(top.release_date ?? top.first_air_date) === year) best = top;
    }
    // "Marvel Studios Iron Man 2008": a studio or brand before the title. With a year to
    // confirm it, try again without the first word or two.
    const words = title.split(/\s+/);
    for (let drop = 1; !best && year && drop <= 2 && words.length - drop >= 1; drop++) {
      const shorter = words.slice(drop).join(" ");
      if (shorter.length < 3) break;
      const r = (await (type === "movie" ? this.tmdb.searchMovie(shorter, year) : this.tmdb.searchShow(shorter, year))).results;
      best = pickBest(r, shorter, year, true);
    }
    if (!best) return null;
    return {
      source: "tmdb",
      type,
      titleId: best.id,
      title: best.title ?? best.name ?? title,
      year: yearOf(best.release_date ?? best.first_air_date),
      posterPath: best.poster_path ?? null,
      backdropPath: best.backdrop_path ?? null,
      genreIds: best.genre_ids ?? null,
    };
  }
}

/** `exactYear`: only a result from that year counts (used when the title was guessed at). */
export function pickBest(results: TmdbListItem[], title: string, year?: number, exactYear = false): TmdbListItem | null {
  const wanted = normalize(title);
  let best: { item: TmdbListItem; score: number } | null = null;
  // TMDB's own ordering (popularity-weighted relevance) is a good tiebreaker.
  results.slice(0, 10).forEach((item, rank) => {
    // The original title too: a file named in Russian or Japanese, TMDB answering in English.
    const names = [item.title ?? item.name ?? "", item.original_title ?? item.original_name ?? ""].map(normalize).filter(Boolean);
    const similarity = Math.max(0, ...names.map((name) => (name === wanted ? 1 : diceCoefficient(name, wanted))));
    if (similarity < 0.6) return;
    const itemYear = yearOf(item.release_date ?? item.first_air_date);
    if (exactYear && itemYear !== year) return;
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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

export function diceCoefficient(a: string, b: string): number {
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
