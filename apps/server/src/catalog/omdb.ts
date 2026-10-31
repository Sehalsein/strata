import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { tmdbCache } from "../db/schema";
import { logger } from "../log";

const log = logger("omdb");
const BASE = "https://www.omdbapi.com/";
const FETCH_TIMEOUT_MS = 5_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** OMDb's free keys allow 1,000 requests a day, so answers are kept a while. */
const TITLE_TTL_MS = 3 * DAY;
const SEASON_TTL_MS = DAY;
/** A lookup that failed (OMDb down, key over its limit) isn't retried for this long. */
const FAILURE_TTL_MS = 10 * 60_000;
const IMDB_ID = /^tt\d{5,10}$/;

export interface Ratings {
  /** IMDb user rating, 0–10. */
  imdb?: number;
  /** Rotten Tomatoes Tomatometer, 0–100. */
  rottenTomatoes?: number;
}

interface OmdbTitle {
  Response: "True" | "False";
  Error?: string;
  imdbRating?: string;
  Ratings?: { Source: string; Value: string }[];
}
interface OmdbSeason {
  Response: "True" | "False";
  Error?: string;
  Episodes?: { Episode: string; imdbRating?: string }[];
}

/** "8.1" → 8.1; OMDb uses "N/A" for no rating. */
const decimal = (value?: string) => {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : undefined;
};
const percent = (value?: string) => (value && /^\d{1,3}%$/.test(value) ? Number(value.slice(0, -1)) : undefined);

/**
 * OMDb: IMDb and Rotten Tomatoes ratings by IMDb id, and IMDb ratings per episode.
 * Optional: with no key every lookup answers null. Cached in tmdb_cache under "omdb:".
 */
export class Omdb {
  private inflight = new Map<string, Promise<unknown>>();
  private failures = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly getKey: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return !!this.getKey();
  }

  /** Validates a key without caching anything. */
  async testKey(key: string): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${BASE}?${new URLSearchParams({ apikey: key, i: "tt0111161" })}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return res.ok && ((await res.json()) as OmdbTitle).Response === "True";
    } catch {
      return false;
    }
  }

  /** Ratings for a movie or series, or null (no key, unknown id, OMDb unavailable). */
  async ratings(imdbId: string | null | undefined): Promise<Ratings | null> {
    if (!imdbId || !IMDB_ID.test(imdbId)) return null;
    const body = await this.get<OmdbTitle>({ i: imdbId }, TITLE_TTL_MS);
    if (!body) return null;
    const imdb = decimal(body.imdbRating);
    const rottenTomatoes = percent(body.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value);
    if (imdb === undefined && rottenTomatoes === undefined) return null;
    return { ...(imdb !== undefined ? { imdb } : {}), ...(rottenTomatoes !== undefined ? { rottenTomatoes } : {}) };
  }

  /** IMDb rating per episode number for one season of a series; empty when unknown. */
  async episodeRatings(seriesImdbId: string | null | undefined, season: number): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    // OMDb has no specials season.
    if (!seriesImdbId || !IMDB_ID.test(seriesImdbId) || !Number.isInteger(season) || season < 1) return out;
    const body = await this.get<OmdbSeason>({ i: seriesImdbId, Season: String(season) }, SEASON_TTL_MS);
    for (const e of body?.Episodes ?? []) {
      const n = Number(e.Episode);
      const rating = decimal(e.imdbRating);
      if (Number.isInteger(n) && rating !== undefined) out.set(n, rating);
    }
    return out;
  }

  private async get<T extends { Response: string; Error?: string }>(params: Record<string, string>, ttl: number): Promise<T | null> {
    const key = this.getKey();
    if (!key) return null;
    const cacheKey = "omdb:" + new URLSearchParams(Object.entries(params).sort()).toString();
    const row = this.db.select().from(tmdbCache).where(eq(tmdbCache.key, cacheKey)).get();
    if (row && Date.now() - row.fetchedAt < ttl) return JSON.parse(row.json) as T;
    if (Date.now() - (this.failures.get(cacheKey) ?? 0) < FAILURE_TTL_MS) return row ? (JSON.parse(row.json) as T) : null;

    const pending = (this.inflight.get(cacheKey) as Promise<T | null> | undefined) ?? this.fetch<T>(params, key, cacheKey);
    const fresh = await pending;
    // A failed refresh keeps the old copy.
    return fresh ?? (row ? (JSON.parse(row.json) as T) : null);
  }

  private fetch<T extends { Response: string; Error?: string }>(params: Record<string, string>, key: string, cacheKey: string): Promise<T | null> {
    const promise = (async () => {
      try {
        const res = await this.fetchImpl(`${BASE}?${new URLSearchParams({ ...params, apikey: key })}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const text = await res.text();
        const body = (res.headers.get("Content-Type")?.includes("json") || text.startsWith("{") ? JSON.parse(text) : { Response: "False" }) as T;
        // "Incorrect IMDb ID" / "Series or season not found" are answers worth caching;
        // a bad key or the daily limit is not.
        if (!res.ok || (body.Response === "False" && !/not found|incorrect imdb id/i.test(body.Error ?? ""))) {
          log.warn(`OMDb ${params.i}${params.Season ? ` S${params.Season}` : ""} failed: ${res.status} ${body.Error ?? ""}`.trim());
          this.failed(cacheKey);
          return null;
        }
        const fetchedAt = Date.now();
        this.db.insert(tmdbCache).values({ key: cacheKey, json: text, fetchedAt }).onConflictDoUpdate({ target: tmdbCache.key, set: { json: text, fetchedAt } }).run();
        return body;
      } catch (err) {
        log.warn(`OMDb ${params.i} failed: ${(err as Error).message}`);
        this.failed(cacheKey);
        return null;
      }
    })().finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, promise);
    return promise;
  }

  private failed(cacheKey: string) {
    this.failures.set(cacheKey, Date.now());
    if (this.failures.size > 1_000) this.failures.delete(this.failures.keys().next().value!);
  }
}
