import { logger } from "../../log";
import { runtime } from "#runtime";
import type { ApiCache } from "../apiCache";
import { shareInFlight } from "../../inFlight";
import { globalFetch } from "../../net";

const log = logger("anilist");
const ENDPOINT = "https://graphql.anilist.co";

/**
 * AniList blocks Cloudflare Workers' addresses ("manually blocked"), so the cloud server
 * reaches it through a relay elsewhere (deploy/anilist-relay) when one is set.
 */
export interface AnilistRelay {
  url: string;
  secret: string;
}

export function anilistRelayFromEnv(): AnilistRelay | undefined {
  const url = process.env.ANILIST_RELAY_URL;
  const secret = process.env.ANILIST_RELAY_SECRET;
  return url && secret ? { url, secret } : undefined;
}
/** AniList allows 30 requests a minute right now: one every 2s, lazily, never bulk. */
const MIN_INTERVAL_MS = 2_100;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
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
  coverImage?: { extraLarge?: string | null; large?: string | null };
  bannerImage?: string | null;
  isAdult?: boolean | null;
}

const SEARCH = `query ($q: String) {
  Page(perPage: 8) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      id format episodes seasonYear title { romaji english native } synonyms coverImage { extraLarge large } bannerImage isAdult
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
 * An anime in one of the Anime tab's lists: enough of AniList's media for a card, and
 * for Latest Episodes, the episode that aired.
 */
export interface AnilistHomeItem {
  id: number;
  format?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  title?: { english?: string | null; romaji?: string | null };
  coverImage?: { extraLarge?: string | null; large?: string | null };
  /** Wide artwork; many titles have none. */
  bannerImage?: string | null;
  /** Plain text, with the odd <br> or <i> AniList keeps. */
  description?: string | null;
  /** Out of 100. */
  averageScore?: number | null;
  /** Latest Episodes: the episode that aired. */
  aired?: { episode: number; airingAt: number };
}

export type AnilistSeasonName = "WINTER" | "SPRING" | "SUMMER" | "FALL";
export interface AnilistSeason {
  season: AnilistSeasonName;
  year: number;
}

/** The anime season `date` is in: Winter is January to March, and so on. */
export function seasonOf(date: Date): AnilistSeason {
  const names: AnilistSeasonName[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
  return { season: names[Math.floor(date.getUTCMonth() / 3)]!, year: date.getUTCFullYear() };
}

export type AnilistHome = Record<AnilistRankedList | "latest", AnilistHomeItem[]> & { currentSeason: AnilistSeason };

const LIST = "id format episodes seasonYear title { english romaji } coverImage { extraLarge large } bannerImage description(asHtml: false) averageScore";
const JP = "type: ANIME, isAdult: false, countryOfOrigin: JP";
/** The Anime tab's ranked lists, as AniList media filters. */
const RANKED = {
  trending: "sort: TRENDING_DESC",
  /** This season's anime, most popular first (needs $season and $seasonYear). */
  season: "season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC",
  airing: "status: RELEASING, sort: POPULARITY_DESC",
  popular: "sort: POPULARITY_DESC",
  favourites: "sort: FAVOURITES_DESC",
  completed: "status: FINISHED, popularity_greater: 15000, sort: END_DATE_DESC",
  upcoming: "status: NOT_YET_RELEASED, sort: POPULARITY_DESC",
} as const;
export type AnilistRankedList = keyof typeof RANKED;
export const ANILIST_RANKED_LISTS = Object.keys(RANKED) as AnilistRankedList[];

const ranked = (name: AnilistRankedList, perPage: number) => `${name}: Page(perPage: ${perPage}) { media(${JP}, ${RANKED[name]}) { ${LIST} } }`;
const SEASON_VARS = "$season: MediaSeason, $seasonYear: Int";
/** The Anime tab's ranked lists, in one request. */
const HOME = `query (${SEASON_VARS}) {
  ${ANILIST_RANKED_LISTS.map((name) => ranked(name, name === "upcoming" ? 15 : 20)).join("\n  ")}
}`;

/** Episodes aired between $since and $now: Latest Episodes, asked for apart from the rankings. */
const LATEST = `query ($since: Int, $now: Int) {
  latest: Page(perPage: 50) {
    airingSchedules(airingAt_greater: $since, airingAt_lesser: $now, sort: TIME_DESC) {
      episode airingAt media { ${LIST} isAdult countryOfOrigin popularity }
    }
  }
}`;

type HomeResponse = Record<AnilistRankedList, { media: AnilistHomeItem[] }>;
type LatestResponse = {
  latest: {
    airingSchedules: { episode: number; airingAt: number; media: AnilistHomeItem & { isAdult?: boolean; countryOfOrigin?: string; popularity?: number } }[];
  };
};

/**
 * How long answers are used before they're refreshed (behind a stale copy, see ApiCache):
 * AniList's data rarely changes within a day, and its rate limit is tight.
 */
const TTL = {
  /** The ranked lists. */
  rankings: 12 * HOUR,
  /** Latest Episodes: what aired in the last two days. */
  latest: HOUR,
  /** A finished (or cancelled) title's page: it won't change. */
  finishedTitle: 7 * DAY,
  /** An airing or upcoming title's page: its next episode should be roughly right. */
  title: 12 * HOUR,
  search: 30 * DAY,
  airing: 12 * HOUR,
};
const FINISHED = new Set(["FINISHED", "CANCELLED"]);

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

/** A date as AniList gives it: any part may be missing. */
export interface AnilistDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

/** A related or recommended title: a card's fields, and whether it's anime and for adults. */
export type AnilistLinkedItem = AnilistHomeItem & { type?: string | null; isAdult?: boolean | null };

/** Everything a title page shows, from one request. */
export interface AnilistTitle extends AnilistLinkedItem {
  idMal?: number | null;
  status?: string | null;
  /** Minutes per episode. */
  duration?: number | null;
  genres?: string[] | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  startDate?: AnilistDate | null;
  endDate?: AnilistDate | null;
  studios?: { nodes: { name: string; isAnimationStudio?: boolean }[] } | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  /** Episodes still to air (at most 50), with when. */
  airingSchedule?: { nodes: { episode: number; airingAt: number }[] } | null;
  trailer?: { id?: string | null; site?: string | null } | null;
  relations?: { edges: { relationType?: string | null; node?: AnilistLinkedItem | null }[] } | null;
  recommendations?: { nodes: { mediaRecommendation?: AnilistLinkedItem | null }[] } | null;
}

const LINKED = `${LIST} type isAdult`;
const TITLE = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${LIST} idMal status duration genres isAdult
    title { romaji english native }
    startDate { year month day } endDate { year month day }
    studios { nodes { name isAnimationStudio } }
    nextAiringEpisode { episode airingAt }
    airingSchedule(notYetAired: true, perPage: 50) { nodes { episode airingAt } }
    trailer { id site }
    relations { edges { relationType node { ${LINKED} } } }
    recommendations(perPage: 20, sort: RATING_DESC) { nodes { mediaRecommendation { ${LINKED} } } }
  }
}`;

/** A title page's lifetime: a week once the title is finished, else 12 hours. */
const titleTtl = (data: { Media?: { status?: string | null } | null } | null) => (FINISHED.has(data?.Media?.status ?? "") ? TTL.finishedTitle : TTL.title);

/** AniList couldn't answer (down, rate limited): not the same as finding nothing. */
export class AnilistUnavailableError extends Error {
  constructor() {
    super("AniList is unavailable");
  }
}

/**
 * Minimal AniList client: title search (for matching fansub names), the Anime tab's lists
 * and title pages. Responses are cached (see TTL) and requests spaced to the rate limit.
 */
export class Anilist {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  private pending = 0;

  constructor(
    private readonly cache: ApiCache,
    private readonly fetchImpl: typeof fetch = globalFetch,
    private readonly relay?: AnilistRelay,
  ) {}

  /** Anime whose titles match `query`, best first. Throws when AniList can't answer (rather than finding nothing). */
  async search(query: string): Promise<AnilistMedia[]> {
    const data = await this.request<{ Page: { media: AnilistMedia[] } }>(SEARCH, { q: query }, `anilist:search:v2:${query.toLowerCase()}`, TTL.search);
    if (!data) throw new AnilistUnavailableError();
    return data.Page.media;
  }

  async media(id: number): Promise<AnilistMedia | null> {
    const data = await this.request<{ Media: AnilistMedia }>(DETAILS, { id }, `anilist:media:${id}`, titleTtl);
    return data?.Media ?? null;
  }

  /** What a title page shows (relations, recommendations, airing schedule…), or null. */
  async title(id: number): Promise<AnilistTitle | null> {
    const data = await this.request<{ Media: AnilistTitle }>(TITLE, { id }, `anilist:title:${id}`, titleTtl);
    return data?.Media ?? null;
  }

  /**
   * Every list the Anime tab shows: trending, top airing, most popular and favourited,
   * recently completed, upcoming (one request, cached 12 hours), and episodes aired in the
   * last two days (its own request, cached an hour).
   */
  async home(): Promise<AnilistHome | null> {
    // Rounded to the hour, so the variables are stable within it.
    const now = Math.floor(Date.now() / 3_600_000) * 3_600;
    const currentSeason = seasonOf(new Date(now * 1000));
    const [data, latestData] = await Promise.all([
      this.request<HomeResponse>(HOME, { season: currentSeason.season, seasonYear: currentSeason.year }, `anilist:home:${currentSeason.season}:${currentSeason.year}`, TTL.rankings),
      this.request<LatestResponse>(LATEST, { since: now - 2 * 86_400, now }, "anilist:latest", TTL.latest),
    ]);
    if (!data) return null;
    const seen = new Set<number>();
    const latest = (latestData?.latest.airingSchedules ?? [])
      .filter((s) => !s.media.isAdult && s.media.countryOfOrigin === "JP" && (s.media.popularity ?? 0) >= LATEST_MIN_POPULARITY)
      // Newest first: a show that aired twice keeps its latest episode.
      .filter((s) => !seen.has(s.media.id) && !!seen.add(s.media.id))
      .map(({ media: { isAdult: _, countryOfOrigin: __, popularity: ___, ...media }, episode, airingAt }) => ({ ...media, aired: { episode, airingAt } }));
    return {
      currentSeason,
      trending: data.trending.media,
      season: data.season.media,
      airing: data.airing.media,
      popular: data.popular.media,
      favourites: data.favourites.media,
      completed: data.completed.media,
      upcoming: data.upcoming.media,
      latest,
    };
  }

  /** One of the Anime tab's ranked lists in full ("See all"): its top 50, cached 12 hours. */
  async list(name: AnilistRankedList): Promise<AnilistHomeItem[] | null> {
    // Only the season list takes variables (GraphQL refuses ones a query doesn't use).
    const current = seasonOf(new Date());
    const [query, vars, key] =
      name === "season"
        ? [`query (${SEASON_VARS}) { ${ranked(name, 50)} }`, { season: current.season, seasonYear: current.year }, `anilist:list:season:${current.season}:${current.year}`]
        : [`query { ${ranked(name, 50)} }`, {}, `anilist:list:${name}`];
    const data = await this.request<Record<string, { media: AnilistHomeItem[] }>>(query, vars, key, TTL.rankings);
    return data?.[name]?.media ?? null;
  }

  /**
   * When these titles' episodes air between `from` and `to` (Unix seconds), soonest first:
   * one request for all of them, cached 12 hours. At most 50 episodes.
   */
  async airing(mediaIds: number[], from: number, to: number): Promise<AiringEpisode[]> {
    if (!mediaIds.length) return [];
    const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
    const data = await this.request<{ Page: { airingSchedules: AiringEpisode[] } }>(AIRING, { ids, from, to }, `anilist:airing:${ids.join(",")}:${from}:${to}`, TTL.airing);
    return data?.Page.airingSchedules ?? [];
  }

  /** A cached answer, or AniList's. A `ttl` that depends on the answer is decided by the copy already cached. */
  private async request<T>(query: string, variables: Record<string, unknown>, cacheKey: string, ttl: number | ((cached: T | null) => number)): Promise<T | null> {
    if (this.pending >= MAX_PENDING) {
      // Too many waiting for AniList's slow lane: whatever is cached will do.
      return ((await this.cache.read(cacheKey))?.value as T | undefined) ?? null;
    }
    try {
      const lifetime = typeof ttl === "number" ? ttl : ttl(((await this.cache.read(cacheKey))?.value as T | undefined) ?? null);
      return await this.cache.get<T | null>(cacheKey, { ttl: lifetime, maxStale: MAX_STALE_MS, backoff: FAILURE_TTL_MS }, () => this.fetchQueued<T>(query, variables));
    } catch (err) {
      log.warn(`AniList request failed`, err);
      return null;
    }
  }

  /** One request at a time, at least MIN_INTERVAL_MS apart (AniList's rate limit). */
  private async fetchQueued<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
    this.pending++;
    // One at a time, spaced to the rate limit (on Workers, per request: see inFlight.ts).
    const run = (shareInFlight ? this.queue : Promise.resolve()).then(async () => {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await runtime.sleep(wait);
      this.last = Date.now();
      const res = await this.fetchImpl(this.relay?.url ?? ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(this.relay && { Authorization: `Bearer ${this.relay.secret}` }) },
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
