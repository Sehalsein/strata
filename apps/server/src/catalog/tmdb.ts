import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { tmdbCache } from "../db/schema";
import { logger } from "../log";

const FETCH_TIMEOUT_MS = 8_000;
const MEMO_ENTRIES = 400;
const REFRESH_BACKOFF_MS = 60_000;
const log = logger("tmdb");
const BASE = "https://api.themoviedb.org/3";
const HOUR = 3_600_000;

/** Ids go into request paths: whole numbers only (season 0 = specials is allowed). */
function assertTmdbId(id: number, zeroOk = false) {
  if (!Number.isInteger(id) || id < (zeroOk ? 0 : 1)) throw new TmdbError("That title isn't in the catalog.", 404);
}
const DAY = 24 * HOUR;

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Subsets of TMDB's response shapes — only fields Strata reads.
export interface TmdbListItem {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  genre_ids?: number[];
}
export interface TmdbPage<T = TmdbListItem> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}
export interface TmdbCredits {
  cast: { id: number; name: string; character?: string; profile_path?: string | null; order?: number }[];
  crew: { id: number; name: string; job: string; department?: string; profile_path?: string | null }[];
}
export interface TmdbMovie {
  id: number;
  imdb_id?: string | null;
  title: string;
  original_title?: string;
  tagline?: string;
  overview?: string;
  release_date?: string;
  runtime?: number | null;
  genres: { id: number; name: string }[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  belongs_to_collection?: { id: number; name: string; poster_path?: string | null } | null;
  credits?: TmdbCredits;
  recommendations?: TmdbPage;
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[] };
  external_ids?: { imdb_id?: string | null };
  videos?: { results: { key: string; site: string; type: string; official?: boolean; name: string }[] };
}
export interface TmdbShow {
  id: number;
  name: string;
  original_name?: string;
  tagline?: string;
  overview?: string;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  episode_run_time?: number[];
  genres: { id: number; name: string }[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  number_of_seasons?: number;
  seasons: { season_number: number; name: string; episode_count: number; air_date?: string | null; poster_path?: string | null; overview?: string }[];
  next_episode_to_air?: { season_number: number; episode_number: number; air_date?: string } | null;
  credits?: TmdbCredits;
  recommendations?: TmdbPage;
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  videos?: TmdbMovie["videos"];
}
export interface TmdbPersonCredit extends TmdbListItem {
  media_type: "movie" | "tv";
  character?: string;
  job?: string;
  popularity?: number;
  vote_count?: number;
}
export interface TmdbPerson {
  id: number;
  name: string;
  biography?: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  known_for_department?: string;
  combined_credits?: { cast: TmdbPersonCredit[]; crew: TmdbPersonCredit[] };
}

export interface TmdbEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  overview?: string;
  air_date?: string | null;
  runtime?: number | null;
  still_path?: string | null;
  vote_average?: number;
}
export interface TmdbSeason {
  id: number;
  season_number: number;
  name: string;
  overview?: string;
  air_date?: string | null;
  poster_path?: string | null;
  episodes: TmdbEpisode[];
}

export class Tmdb {
  private inflight = new Map<string, Promise<unknown>>();
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    private readonly db: Db,
    private readonly getKey: () => string | undefined,
    private readonly getLanguage: () => string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return !!this.getKey();
  }

  /** Validates a key without caching anything. */
  async testKey(key: string): Promise<boolean> {
    const res = await this.fetchImpl(this.url("/configuration", {}, key), { headers: this.headers(key) });
    return res.ok;
  }

  movie(id: number) {
    assertTmdbId(id);
    return this.get<TmdbMovie>(`/movie/${id}`, { append_to_response: "credits,recommendations,release_dates,external_ids,videos" }, 3 * DAY);
  }
  show(id: number) {
    assertTmdbId(id);
    return this.get<TmdbShow>(`/tv/${id}`, { append_to_response: "credits,recommendations,content_ratings,external_ids,videos" }, DAY);
  }
  season(showId: number, season: number) {
    assertTmdbId(showId);
    assertTmdbId(season, true);
    return this.get<TmdbSeason>(`/tv/${showId}/season/${season}`, {}, DAY);
  }
  searchMovie(query: string, year?: number) {
    return this.get<TmdbPage>("/search/movie", { query, ...(year ? { year: String(year) } : {}) }, DAY);
  }
  searchShow(query: string, year?: number) {
    return this.get<TmdbPage>("/search/tv", { query, ...(year ? { first_air_date_year: String(year) } : {}) }, DAY);
  }
  searchMulti(query: string) {
    return this.get<TmdbPage>("/search/multi", { query }, 6 * HOUR);
  }
  genres(type: "movie" | "tv") {
    return this.get<{ genres: { id: number; name: string }[] }>(`/genre/${type}/list`, {}, 7 * DAY);
  }
  /** TMDB discover: `params` are passed through (with_genres, sort_by, date bounds…). */
  discover(type: "movie" | "tv", params: Record<string, string>) {
    return this.get<TmdbPage>(`/discover/${type}`, { include_adult: "false", ...params }, 6 * HOUR);
  }
  person(id: number) {
    return this.get<TmdbPerson>(`/person/${id}`, { append_to_response: "combined_credits" }, 3 * DAY);
  }
  trending(type: "movie" | "tv", page = 1) {
    return this.get<TmdbPage>(`/trending/${type}/week`, page > 1 ? { page: String(page) } : {}, 6 * HOUR);
  }
  popular(type: "movie" | "tv") {
    return this.get<TmdbPage>(`/${type}/popular`, {}, 12 * HOUR);
  }
  topRated(type: "movie" | "tv") {
    return this.get<TmdbPage>(`/${type}/top_rated`, {}, DAY);
  }

  private async get<T>(path: string, params: Record<string, string>, ttl: number): Promise<T> {
    const key = this.getKey();
    if (!key) throw new TmdbError("The movie catalog isn't set up yet. Add a TMDB key in the server dashboard.", 503);
    const query = { ...params, language: this.getLanguage() };
    const cacheKey = path + "?" + new URLSearchParams(Object.entries(query).sort()).toString();

    const cached = this.cached(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.value as T;
    if (cached) {
      // Stale: answer now from the cache and refresh behind it, so a page never
      // waits on TMDB for data it already has. A failed refresh keeps the old copy.
      const failedAt = this.refreshFailedAt.get(cacheKey) ?? 0;
      if (!this.inflight.has(cacheKey) && Date.now() - failedAt > REFRESH_BACKOFF_MS) {
        this.fetch<T>(path, query, key, cacheKey).catch(() => {
          this.refreshFailedAt.set(cacheKey, Date.now());
          if (this.refreshFailedAt.size > 1_000) this.refreshFailedAt.delete(this.refreshFailedAt.keys().next().value!);
        });
      }
      return cached.value as T;
    }
    return ((this.inflight.get(cacheKey) as Promise<T> | undefined) ?? this.fetch<T>(path, query, key, cacheKey));
  }

  /** When a background refresh last failed, per key (TMDB down: don't retry on every view). */
  private refreshFailedAt = new Map<string, number>();

  /** Parsed responses, most recently used last; bounded, since detail pages run ~40 KB. */
  private memo = new Map<string, { fetchedAt: number; value: unknown }>();

  private cached(cacheKey: string): { fetchedAt: number; value: unknown } | null {
    const hit = this.memo.get(cacheKey);
    if (hit) {
      this.memo.delete(cacheKey);
      this.memo.set(cacheKey, hit);
      return hit;
    }
    const row = this.db.select().from(tmdbCache).where(eq(tmdbCache.key, cacheKey)).get();
    if (!row) return null;
    return this.remember(cacheKey, { fetchedAt: row.fetchedAt, value: JSON.parse(row.json) });
  }

  private remember(cacheKey: string, entry: { fetchedAt: number; value: unknown }) {
    this.memo.delete(cacheKey);
    this.memo.set(cacheKey, entry);
    if (this.memo.size > MEMO_ENTRIES) this.memo.delete(this.memo.keys().next().value!);
    return entry;
  }

  private fetch<T>(path: string, query: Record<string, string>, key: string, cacheKey: string): Promise<T> {
    const promise = this.limited(async () => {
      // A hung request would hold one of the few slots and stall every page behind it.
      const res = await this.fetchImpl(this.url(path, query, key), { headers: this.headers(key), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        log.warn(`TMDB ${path} failed: ${res.status}`);
        throw new TmdbError(res.status === 404 ? "That title isn't in the catalog." : "The movie catalog isn't responding. Try again in a moment.", res.status === 404 ? 404 : 502);
      }
      const text = await res.text();
      const fetchedAt = Date.now();
      this.db
        .insert(tmdbCache)
        .values({ key: cacheKey, json: text, fetchedAt })
        .onConflictDoUpdate({ target: tmdbCache.key, set: { json: text, fetchedAt } })
        .run();
      return this.remember(cacheKey, { fetchedAt, value: JSON.parse(text) }).value as T;
    }).finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, promise);
    return promise;
  }

  private url(path: string, params: Record<string, string>, key: string) {
    const search = new URLSearchParams(params);
    if (!isBearer(key)) search.set("api_key", key);
    return `${BASE}${path}?${search}`;
  }

  private headers(key: string): Record<string, string> {
    return isBearer(key) ? { Authorization: `Bearer ${key}`, Accept: "application/json" } : { Accept: "application/json" };
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 8) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** v4 read-access tokens are JWTs; v3 keys are 32-char hex. */
const isBearer = (key: string) => key.startsWith("eyJ");

export function imageUrl(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" | "w1280" | "original" = "w500") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
