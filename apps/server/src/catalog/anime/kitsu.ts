import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { tmdbCache } from "../../db/schema";
import { logger } from "../../log";
import type { AnilistMedia } from "./anilist";

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
  private inFlight = new Map<string, Promise<KitsuAnime[] | null>>();
  private failures = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
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

  private async request(path: string, cacheKey: string, ttl: number): Promise<KitsuAnime[] | null> {
    const cached = this.db.select().from(tmdbCache).where(eq(tmdbCache.key, cacheKey)).get();
    if (cached && Date.now() - cached.fetchedAt < ttl) return JSON.parse(cached.json) as KitsuAnime[];
    const stale = cached && Date.now() - cached.fetchedAt < MAX_STALE_MS ? (JSON.parse(cached.json) as KitsuAnime[]) : null;

    const failedAt = this.failures.get(cacheKey);
    if (failedAt && Date.now() - failedAt < FAILURE_TTL_MS) return stale;
    const sharing = this.inFlight.get(cacheKey);
    if (sharing) return sharing;

    const work = (async () => {
      try {
        const res = await this.fetchImpl(`${BASE}/${path}`, { headers: { Accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Kitsu HTTP ${res.status}`);
        const body = (await res.json()) as { data?: unknown };
        if (!Array.isArray(body.data)) throw new Error("Kitsu: unexpected response");
        const data = body.data as KitsuAnime[];
        this.failures.delete(cacheKey);
        const row = { key: cacheKey, json: JSON.stringify(data), fetchedAt: Date.now() };
        this.db.insert(tmdbCache).values(row).onConflictDoUpdate({ target: tmdbCache.key, set: { json: row.json, fetchedAt: row.fetchedAt } }).run();
        return data;
      } catch (err) {
        log.warn("Kitsu request failed", err);
        this.failures.delete(cacheKey);
        this.failures.set(cacheKey, Date.now());
        if (this.failures.size > 1_000) this.failures.delete(this.failures.keys().next().value!);
        return stale;
      }
    })().finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, work);
    return work;
  }
}
