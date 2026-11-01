import { logger } from "../../log";
import type { ApiCache } from "../apiCache";
import type { AnilistMedia } from "./anilist";
import { globalFetch } from "../../net";

const log = logger("kitsu");
const BASE = "https://kitsu.app/api/edge";
const HOUR = 60 * 60_000;
/** A lookup that failed isn't retried for this long. */
const FAILURE_TTL_MS = 10 * 60_000;
const MAX_STALE_MS = 30 * 24 * HOUR;

interface KitsuAnime {
  id: string;
  attributes: {
    canonicalTitle?: string | null;
    titles?: Record<string, string | null>;
    abbreviatedTitles?: string[] | null;
    subtype?: string | null;
    startDate?: string | null;
  };
}

export type KitsuRail = "season" | "lastSeason" | "top" | "popular" | "recent";

/** The Anime tab's categories: Kitsu category slugs and their names. */
export const ANIME_CATEGORIES: { id: string; name: string }[] = [
  ["action", "Action"], ["adventure", "Adventure"], ["comedy", "Comedy"], ["drama", "Drama"], ["fantasy", "Fantasy"],
  ["isekai", "Isekai"], ["romance", "Romance"], ["slice-of-life", "Slice of Life"], ["science-fiction", "Sci-Fi"],
  ["mystery", "Mystery"], ["psychological", "Psychological"], ["thriller", "Thriller"], ["horror", "Horror"],
  ["supernatural", "Supernatural"], ["sports", "Sports"], ["mecha", "Mecha"], ["music", "Music"],
  ["school-life", "School"], ["martial-arts", "Martial Arts"], ["historical", "Historical"],
  ["shounen", "Shounen"], ["seinen", "Seinen"], ["shoujo", "Shoujo"],
].map(([id, name]) => ({ id: id!, name: name! }));
const CATEGORY_IDS = new Set(ANIME_CATEGORIES.map((c) => c.id));

const SEASONS = ["winter", "spring", "summer", "fall"] as const;

/**
 * Kitsu: ranked anime lists for the Anime rails, and title search when AniList is
 * unavailable. Kitsu ids map to TMDB through the anime id list. Cached in tmdb_cache.
 */
export class Kitsu {

  constructor(
    private readonly cache: ApiCache,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  /** Kitsu ids, in rank order, for one rail of series or films. */
  async rail(kind: "series" | "films", rail: KitsuRail, opts: { category?: string; now?: Date } = {}): Promise<number[]> {
    const now = opts.now ?? new Date();
    const subtype = kind === "films" ? "movie" : "TV";
    const q = new URLSearchParams({ "filter[subtype]": subtype, "page[limit]": "20" });
    // Only known slugs reach Kitsu (and the cache key).
    if (opts.category && CATEGORY_IDS.has(opts.category)) q.set("filter[categories]", opts.category);
    const quarter = Math.floor(now.getUTCMonth() / 3);
    const year = now.getUTCFullYear();
    switch (rail) {
      case "season":
      case "lastSeason": {
        const back = rail === "lastSeason" ? 1 : 0;
        const index = (quarter - back + 4) % 4;
        q.set("filter[season]", SEASONS[index]!);
        q.set("filter[seasonYear]", String(quarter - back < 0 ? year - 1 : year));
        q.set("sort", "-userCount");
        break;
      }
      case "recent":
        q.set("filter[seasonYear]", `${year - 2}..${year}`);
        q.set("sort", "popularityRank");
        break;
      case "top":
        q.set("sort", "ratingRank");
        break;
      case "popular":
        q.set("sort", "popularityRank");
        break;
    }
    const list = await this.request(`anime?${q}`, `kitsu:rail:${kind}:${rail}:${q.get("filter[seasonYear]") ?? ""}:${q.get("filter[season]") ?? ""}:${q.get("filter[categories]") ?? ""}`, 12 * HOUR);
    return (list ?? []).map((a) => Number(a.id)).filter((id) => Number.isInteger(id) && id > 0);
  }

  /** Title search, shaped like AniList's results (ids are Kitsu's). */
  async search(query: string): Promise<AnilistMedia[]> {
    const q = new URLSearchParams({ "filter[text]": query, "page[limit]": "8" });
    const list = await this.request(`anime?${q}`, `kitsu:search:${query.toLowerCase()}`, 7 * 24 * HOUR);
    return (list ?? []).map((a) => {
      const t = a.attributes.titles ?? {};
      return {
        id: Number(a.id),
        format: a.attributes.subtype === "movie" ? "MOVIE" : a.attributes.subtype?.toUpperCase() ?? null,
        seasonYear: a.attributes.startDate ? Number(a.attributes.startDate.slice(0, 4)) : null,
        title: { romaji: t.en_jp ?? a.attributes.canonicalTitle ?? null, english: t.en ?? t.en_us ?? null, native: t.ja_jp ?? null },
        synonyms: [a.attributes.canonicalTitle, ...(a.attributes.abbreviatedTitles ?? [])].filter((n): n is string => !!n),
      };
    });
  }

  /**
   * Kitsu's age rating for an anime ("G", "PG", "R" or "R18"), or null when it has none.
   * Cached 30 days. Throws when Kitsu can't be asked.
   */
  async ageRating(kitsuId: number): Promise<string | null> {
    if (!Number.isInteger(kitsuId) || kitsuId <= 0) return null;
    return this.cache.get<string | null>(`kitsu:age:${kitsuId}`, { ttl: 30 * 24 * HOUR, maxStale: MAX_STALE_MS, backoff: FAILURE_TTL_MS }, async () => {
      const res = await this.fetchImpl(`${BASE}/anime/${kitsuId}?fields%5Banime%5D=ageRating`, { headers: { Accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(15_000) });
      // Kitsu doesn't have it: no rating (remembered like one).
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { attributes?: { ageRating?: unknown } } };
      const rating = body.data?.attributes?.ageRating;
      return typeof rating === "string" && rating ? rating : null;
    });
  }

  private async request(path: string, cacheKey: string, ttl: number): Promise<KitsuAnime[] | null> {
    try {
      return await this.cache.get<KitsuAnime[]>(cacheKey, { ttl, maxStale: MAX_STALE_MS, backoff: FAILURE_TTL_MS }, async () => {
        const res = await this.fetchImpl(`${BASE}/${path}`, { headers: { Accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
        const body = (await res.json()) as { data?: unknown };
        if (!Array.isArray(body.data)) throw new Error("Kitsu: unexpected response");
        return body.data as KitsuAnime[];
      });
    } catch (err) {
      log.warn("Kitsu request failed", err);
      return null;
    }
  }
}
