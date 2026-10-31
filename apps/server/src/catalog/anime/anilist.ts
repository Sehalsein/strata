import { logger } from "../../log";
import { runtime } from "#runtime";
import type { ApiCache } from "../apiCache";

const log = logger("anilist");
const ENDPOINT = "https://graphql.anilist.co";
/** AniList allows 30 requests a minute right now: one every 2s, lazily, never bulk. */
const MIN_INTERVAL_MS = 2_100;
const DAY = 24 * 60 * 60_000;
/** Requests waiting for their turn; beyond this, new ones are refused rather than queued. */
const MAX_PENDING = 20;
/** A lookup that failed isn't retried for this long. */
const FAILURE_TTL_MS = 10 * 60_000;
const MAX_STALE_MS = 30 * DAY;

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

/** A ranked list on the Anime tab: AniList media, with the episode that aired for schedules. */
export interface AnilistHomeItem {
  id: number;
  format?: string | null;
  episodes?: number | null;
  /** Latest Episodes: the episode that aired. */
  aired?: { episode: number; airingAt: number };
}

export type AnilistHome = Record<"trending" | "airing" | "popular" | "favourites" | "completed" | "upcoming" | "latest", AnilistHomeItem[]>;

const LIST = "id format episodes";
const JP = "type: ANIME, isAdult: false, countryOfOrigin: JP";
const HOME = `query ($since: Int, $now: Int) {
  trending: Page(perPage: 20) { media(${JP}, sort: TRENDING_DESC) { ${LIST} } }
  airing: Page(perPage: 20) { media(${JP}, status: RELEASING, sort: POPULARITY_DESC) { ${LIST} } }
  popular: Page(perPage: 20) { media(${JP}, sort: POPULARITY_DESC) { ${LIST} } }
  favourites: Page(perPage: 20) { media(${JP}, sort: FAVOURITES_DESC) { ${LIST} } }
  completed: Page(perPage: 20) { media(${JP}, status: FINISHED, popularity_greater: 15000, sort: END_DATE_DESC) { ${LIST} } }
  upcoming: Page(perPage: 15) { media(${JP}, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) { ${LIST} } }
  latest: Page(perPage: 50) {
    airingSchedules(airingAt_greater: $since, airingAt_lesser: $now, sort: TIME_DESC) {
      episode airingAt media { ${LIST} isAdult countryOfOrigin popularity }
    }
  }
}`;

type HomeResponse = Record<Exclude<keyof AnilistHome, "latest">, { media: AnilistHomeItem[] }> & {
  latest: {
    airingSchedules: { episode: number; airingAt: number; media: AnilistHomeItem & { isAdult?: boolean; countryOfOrigin?: string; popularity?: number } }[];
  };
};

const AIRING = `query ($ids: [Int], $from: Int, $to: Int) {
  Page(perPage: 50) {
    airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { mediaId episode airingAt }
  }
}`;

export interface AiringEpisode {
  mediaId: number;
  episode: number;
  /** Unix seconds. */
  airingAt: number;
}

/** Below this many AniList users, a just-aired episode is too obscure for Latest Episodes. */
const LATEST_MIN_POPULARITY = 2_000;

/**
 * Minimal AniList client: title search (for matching fansub names) and details for
 * title pages. Responses are cached (a day) and requests spaced to the rate limit.
 */
export class Anilist {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private pending = 0;

  constructor(
    private readonly cache: ApiCache,
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

  /**
   * Every list the Anime tab shows, in one request (cached an hour): trending, top airing,
   * most popular and favourited, recently completed, upcoming, and episodes aired in the
   * last two days.
   */
  async home(): Promise<AnilistHome | null> {
    // Rounded to the hour, so the variables (and the cache key) are stable within it.
    const now = Math.floor(Date.now() / 3_600_000) * 3_600;
    const data = await this.request<HomeResponse>(HOME, { since: now - 2 * 86_400, now }, "anilist:home", 60 * 60_000);
    if (!data) return null;
    const seen = new Set<number>();
    const latest = data.latest.airingSchedules
      .filter((s) => !s.media.isAdult && s.media.countryOfOrigin === "JP" && (s.media.popularity ?? 0) >= LATEST_MIN_POPULARITY)
      // Newest first: a show that aired twice keeps its latest episode.
      .filter((s) => !seen.has(s.media.id) && !!seen.add(s.media.id))
      .map((s) => ({ id: s.media.id, format: s.media.format, episodes: s.media.episodes, aired: { episode: s.episode, airingAt: s.airingAt } }));
    return {
      trending: data.trending.media,
      airing: data.airing.media,
      popular: data.popular.media,
      favourites: data.favourites.media,
      completed: data.completed.media,
      upcoming: data.upcoming.media,
      latest,
    };
  }

  /**
   * When these titles' episodes air between `from` and `to` (Unix seconds), soonest first:
   * one request for all of them, cached an hour. At most 50 episodes.
   */
  async airing(mediaIds: number[], from: number, to: number): Promise<AiringEpisode[]> {
    if (!mediaIds.length) return [];
    const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
    const data = await this.request<{ Page: { airingSchedules: AiringEpisode[] } }>(AIRING, { ids, from, to }, `anilist:airing:${ids.join(",")}:${from}:${to}`, 60 * 60_000);
    return data?.Page.airingSchedules ?? [];
  }

  private async request<T>(query: string, variables: Record<string, unknown>, cacheKey: string, ttl: number): Promise<T | null> {
    if (this.pending >= MAX_PENDING) {
      // Too many waiting for AniList's slow lane: whatever is cached will do.
      return ((await this.cache.read(cacheKey))?.value as T | undefined) ?? null;
    }
    try {
      return await this.cache.get<T | null>(cacheKey, { ttl, maxStale: MAX_STALE_MS, backoff: FAILURE_TTL_MS }, () => this.fetchQueued<T>(query, variables));
    } catch (err) {
      log.warn(`AniList request failed`, err);
      return null;
    }
  }

  /** One request at a time, at least MIN_INTERVAL_MS apart (AniList's rate limit). */
  private async fetchQueued<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
    this.pending++;
    const run = this.queue.then(async () => {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await runtime.sleep(wait);
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
      return await run;
    } finally {
      this.pending--;
    }
  }
}
