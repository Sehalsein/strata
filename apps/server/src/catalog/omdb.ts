import { logger } from "../log";
import type { ApiCache } from "./apiCache";

const log = logger("omdb");
const BASE = "https://www.omdbapi.com/";
const FETCH_TIMEOUT_MS = 5_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** OMDb's free keys allow 1,000 requests a day, so answers are kept a while (ratings move slowly). */
const TITLE_TTL_MS = 7 * DAY;
const SEASON_TTL_MS = 3 * DAY;
/** A lookup that failed (OMDb down) isn't retried for this long. */
const FAILURE_TTL_MS = 10 * 60_000;
/** Requests a day, a little under the free tier's 1,000, counted across every server. */
export const OMDB_DAILY_BUDGET = 900;
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
 * Optional: with no key every lookup answers null. Answers are cached ("omdb:" keys), and
 * requests are counted per UTC day: past the budget, or once OMDb says the key's limit is
 * reached, nothing more is asked until the next day (cached answers keep showing).
 */
export class Omdb {
  constructor(
    private readonly cache: ApiCache,
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
    try {
      return await this.cache.get<T>(cacheKey, { ttl, maxStale: Infinity, backoff: FAILURE_TTL_MS }, () => this.fetch<T>(params, key));
    } catch {
      return null;
    }
  }

  private async fetch<T extends { Response: string; Error?: string }>(params: Record<string, string>, key: string): Promise<T> {
    const day = new Date().toISOString().slice(0, 10);
    const usageKey = `omdb:usage:${day}`;
    const used = ((await this.cache.read(usageKey))?.value as { used: number; blocked?: boolean } | undefined) ?? { used: 0 };
    if (used.blocked || used.used >= OMDB_DAILY_BUDGET) throw new Error("OMDb daily limit reached");
    await this.cache.write(usageKey, { used: used.used + 1 });
    const res = await this.fetchImpl(`${BASE}?${new URLSearchParams({ ...params, apikey: key })}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await res.text();
    const body = (res.headers.get("Content-Type")?.includes("json") || text.startsWith("{") ? JSON.parse(text) : { Response: "False" }) as T;
    if (/limit reached/i.test(body.Error ?? "")) {
      log.warn("OMDb says the key's daily limit is reached; no more lookups until tomorrow (UTC)");
      await this.cache.write(usageKey, { used: used.used + 1, blocked: true });
      throw new Error("OMDb daily limit reached");
    }
    // "Incorrect IMDb ID" / "Series or season not found" are answers worth caching;
    // a bad key or an outage is not.
    if (!res.ok || (body.Response === "False" && !/not found|incorrect imdb id/i.test(body.Error ?? ""))) {
      log.warn(`OMDb ${params.i}${params.Season ? ` S${params.Season}` : ""} failed: ${res.status} ${body.Error ?? ""}`.trim());
      throw new Error(`OMDb ${res.status}`);
    }
    return body;
  }
}
