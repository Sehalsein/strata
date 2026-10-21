import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { tmdbCache } from "../../db/schema";
import { logger } from "../../log";

const log = logger("anilist");
const ENDPOINT = "https://graphql.anilist.co";
/** AniList allows 30 requests a minute right now: one every 2s, lazily, never bulk. */
const MIN_INTERVAL_MS = 2_100;
const DAY = 24 * 60 * 60_000;

export interface AnilistMedia {
  id: number;
  format?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[];
  averageScore?: number | null;
  studios?: { nodes: { name: string; isAnimationStudio?: boolean }[] };
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  status?: string | null;
}

const SEARCH = `query ($q: String) {
  Page(perPage: 8) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      id format episodes seasonYear title { romaji english native } synonyms
    }
  }
}`;

const DETAILS = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id format episodes seasonYear status averageScore title { romaji english native } synonyms
    studios { nodes { name isAnimationStudio } }
    nextAiringEpisode { episode airingAt }
  }
}`;

/**
 * Minimal AniList client: title search (for matching fansub names) and details for
 * title pages. Responses are cached (a day) and requests spaced to the rate limit.
 */
export class Anilist {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<AnilistMedia[]> {
    const data = await this.request<{ Page: { media: AnilistMedia[] } }>(SEARCH, { q: query }, `anilist:search:${query.toLowerCase()}`, 7 * DAY);
    return data?.Page.media ?? [];
  }

  async media(id: number): Promise<AnilistMedia | null> {
    const data = await this.request<{ Media: AnilistMedia }>(DETAILS, { id }, `anilist:media:${id}`, DAY);
    return data?.Media ?? null;
  }

  private async request<T>(query: string, variables: Record<string, unknown>, cacheKey: string, ttl: number): Promise<T | null> {
    const cached = this.db.select().from(tmdbCache).where(eq(tmdbCache.key, cacheKey)).get();
    if (cached && Date.now() - cached.fetchedAt < ttl) return JSON.parse(cached.json) as T;

    // One request at a time, at least MIN_INTERVAL_MS apart.
    const run = this.queue.then(async () => {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      this.last = Date.now();
      const res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) throw new Error("AniList rate limit");
      if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (body.errors?.length) throw new Error(`AniList: ${body.errors[0]!.message}`);
      return body.data ?? null;
    });
    this.queue = run.catch(() => {});
    try {
      const data = await run;
      if (data) {
        const row = { key: cacheKey, json: JSON.stringify(data), fetchedAt: Date.now() };
        this.db.insert(tmdbCache).values(row).onConflictDoUpdate({ target: tmdbCache.key, set: { json: row.json, fetchedAt: row.fetchedAt } }).run();
      }
      return data;
    } catch (err) {
      log.warn(`AniList request failed`, err);
      // A stale answer beats none.
      return cached ? (JSON.parse(cached.json) as T) : null;
    }
  }
}
