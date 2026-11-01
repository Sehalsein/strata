import type { FileProvider } from "../db/schema";
import { runtime } from "#runtime";
import type { Library } from "../library";
import { isResumable, type ProgressRow, type ProgressStore } from "../progress";
import type { Settings } from "../settings";
import { findCandidates, type Candidate } from "../sources/resolver";
import { imageUrl, yearOf, type Tmdb, type TmdbCredits, type TmdbListItem, type TmdbMovie, type TmdbShow } from "./tmdb";
import { logger } from "../log";
import { seasonOf, type Anilist, type AnilistDate, type AnilistHomeItem, type AnilistRankedList, type AnilistSeason, type AnilistTitle } from "./anime/anilist";
import { animeRating } from "./contentRating";
import { tmdbEpisodeOf, type AnimeIds } from "./anime/ids";
import { ANIME_CATEGORIES, type Kitsu, type KitsuRail } from "./anime/kitsu";
import type { Omdb, Ratings } from "./omdb";
import { formatRef, targetRef, tmdbRef, type TitleRef, type TitleTarget } from "./ref";
import type { TmdbEpisode } from "./tmdb";

const log = logger("catalog");

/**
 * TMDB has no anime genre; "Anime" is animation originally in Japanese. Negative so it
 * can never collide with a TMDB genre id.
 */
export const ANIME_GENRE_ID = -1;
const ANIME_DISCOVER = { with_genres: "16", with_original_language: "ja" };
/** Donghua and Korean animation: on the anime id list, but not what "Anime" means here. */
const NOT_ANIME_LANGUAGES = new Set(["zh", "cn", "ko"]);

export type TitleType = "movie" | "show";

export interface TitleCard {
  type: TitleType;
  /** The title's ref ("tmdb:movie:603", see `formatRef`): what newer apps key titles by. */
  ref: string;
  /**
   * TMDB's id, for apps from before refs: always on TMDB titles, and on AniList titles
   * TMDB also has (see `legacyCards` for what those apps get).
   */
  tmdbId?: number;
  title: string;
  year: number | null;
  overview?: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating?: number;
  available: FileProvider[];
  /** Why a title is in the Home hero ("Recently Added", "Trending Anime"). */
  eyebrow?: string;
  /** A short label the apps show with the card as is ("Episode 12", "TV · 24 episodes"). */
  badge?: string;
}

export interface EpisodeRef {
  season: number;
  episode: number;
  name: string;
  stillUrl: string | null;
}

export interface ContinueCard extends TitleCard {
  episode?: EpisodeRef;
  positionMs: number;
  durationMs: number;
}

export interface Shelf {
  id: string;
  title: string;
  kind: "continue" | "titles";
  /** "hero": the apps show it as a carousel at the top of the page. Absent: a rail. */
  style?: "hero";
  items: (TitleCard | ContinueCard)[];
  /** The full list behind the rail ("See all"): an Anime tab list, `GET /api/anime/list/:more`. */
  more?: string;
}

export interface ProgressDto {
  positionMs: number;
  durationMs: number;
  completed: boolean;
}

const progressDto = (row?: ProgressRow): ProgressDto | null => (row ? { positionMs: row.positionMs, durationMs: row.durationMs, completed: row.completed } : null);

/** A Home rail that fails is left out rather than failing the page. */
async function homeSafe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`Home shelf ${label} failed`, err);
    return null;
  }
}

/** The Anime tab's rails after Trending, in order: the AniList list, how many on the rail. */
const ANIME_LISTS: { id: Exclude<AnilistRankedList, "trending"> | "latest"; slug: string; title: string; rail: number; badge?: (i: AnilistHomeItem, laterSeason: boolean) => string | undefined }[] = [
  // Titled with the season itself ("Fall 2026 Anime"): see `animeListTitle`.
  { id: "season", slug: "this-season", title: "This Season", rail: 20 },
  { id: "latest", slug: "latest-episodes", title: "Latest Episodes", rail: 20, badge: (i) => (i.aired ? `Episode ${i.aired.episode}` : undefined) },
  { id: "airing", slug: "top-airing", title: "Airing Now", rail: 15 },
  { id: "popular", slug: "most-popular", title: "Popular", rail: 15 },
  { id: "favourites", slug: "most-favorite", title: "Fan Favorites", rail: 15 },
  { id: "completed", slug: "latest-completed", title: "Recently Finished", rail: 15 },
  { id: "upcoming", slug: "upcoming", title: "Coming Soon", rail: 15, badge: (_, laterSeason) => (laterSeason ? "New season" : undefined) },
];

/**
 * Cards for apps from before refs, which key titles by TMDB id: only titles TMDB has,
 * each once (two AniList seasons of one TMDB show would be the same card to them).
 */
export function legacyCards<T extends { type: string; tmdbId?: number }>(cards: T[]): T[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (card.tmdbId === undefined) return false;
    const key = `${card.type}-${card.tmdbId}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** A list's name on the Anime tab; this season's is the season itself ("Fall 2026 Anime"). */
function animeListTitle(list: { id: string; title: string }, season: AnilistSeason): string {
  if (list.id !== "season") return list.title;
  return `${season.season[0]}${season.season.slice(1).toLowerCase()} ${season.year} Anime`;
}

/** AniList's description as plain text: line breaks kept, its bits of HTML dropped. */
export function plainDescription(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const plain = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain || undefined;
}

/** The Movies and Shows tabs' lists. Latest Releases and New in Theaters are films only. */
export type BrowseList = "trending" | "popular" | "topRated" | "library" | "latestReleases" | "inTheaters";

/** TMDB popularity below which a new release is too obscure for Latest Releases and New in Theaters. */
const MIN_RELEASE_POPULARITY = 10;

/** One of each title, first kept (TMDB's pages can overlap as they shift). */
function dedupe(items: TmdbListItem[]): TmdbListItem[] {
  const seen = new Set<number>();
  return items.filter((i) => !seen.has(i.id) && !!seen.add(i.id));
}

export class CatalogService {
  constructor(
    private readonly tmdb: Tmdb,
    private readonly library: Library,
    private readonly progress: ProgressStore,
    private readonly settings: () => Settings,
    private readonly anime?: { ids: AnimeIds; anilist: Anilist; kitsu?: Kitsu },
    private readonly omdb?: Omdb,
  ) {}

  /** IMDb / Rotten Tomatoes ratings, or null; like AniList, the page waits at most 1.5s. */
  private ratings(imdbId: string | null | undefined): Promise<Ratings | null> {
    if (!this.omdb?.configured || !imdbId) return Promise.resolve(null);
    return Promise.race([this.omdb.ratings(imdbId).catch(() => null), runtime.sleep(1_500).then(() => null)]);
  }

  /** IMDb rating per episode of one season (empty without an OMDb key). */
  private async episodeRatings(showId: number, seasonNumber: number): Promise<Map<number, number>> {
    if (!this.omdb?.configured) return new Map();
    const lookup = async () => {
      const imdbId = (await this.tmdb.show(showId)).external_ids?.imdb_id;
      return this.omdb!.episodeRatings(imdbId, seasonNumber);
    };
    return Promise.race([lookup().catch(() => new Map<number, number>()), runtime.sleep(1_500).then(() => new Map<number, number>())]);
  }

  /**
   * AniList details for an anime title (romaji/Japanese titles, studio, score, next
   * airing), or null. Waits at most 1.5s: AniList is slow to call uncached, and the page
   * shouldn't wait on it; the answer is cached for next time.
   */
  private animeInfo(type: TitleType, tmdbId: number) {
    return Promise.race([this.animeInfoUncapped(type, tmdbId), runtime.sleep(1_500).then(() => null)]);
  }

  private async animeInfoUncapped(type: TitleType, tmdbId: number) {
    if (!this.anime) return null;
    const { ids, anilist } = this.anime;
    await ids.ready();
    const entries = type === "movie" ? [ids.movie(tmdbId)].filter((e) => !!e) : ids.show(tmdbId);
    const first = entries.find((e) => e.anilistId);
    if (!first) return null;
    const latest = [...entries].reverse().find((e) => e.anilistId) ?? first;
    const [media, newest] = await Promise.all([anilist.media(first.anilistId!), latest === first ? null : anilist.media(latest.anilistId!)]);
    if (!media) return null;
    const airing = (newest ?? media).nextAiringEpisode;
    return {
      anilistId: media.id,
      romaji: media.title.romaji ?? null,
      native: media.title.native ?? null,
      studios: media.studios?.nodes.filter((s) => s.isAnimationStudio).map((s) => s.name) ?? [],
      score: media.averageScore ?? null,
      nextEpisode: airing ? { episode: airing.episode, airsAt: airing.airingAt * 1000 } : null,
    };
  }

  /** Home in one answer, for apps that don't ask for its two parts: the hero, the person's rails, then the catalog's. */
  async home(userId: string): Promise<Shelf[]> {
    const [catalog, mine] = await Promise.all([this.homeCatalog(), this.homeProfile(userId)]);
    const featured = catalog.filter((s) => s.id === "featured");
    return [...featured, ...mine, ...catalog.filter((s) => s.id !== "featured")];
  }

  /** Continue Watching, Up Next and My List: this person's own rails, asked for on every visit. */
  async homeProfile(userId: string): Promise<Shelf[]> {
    const [cont, nextUp, watchlist] = await Promise.all([
      homeSafe("continue", () => this.continueWatching(userId)),
      homeSafe("nextUp", () => this.nextUp(userId)),
      homeSafe("watchlist", () => this.watchlist(userId)),
    ]);
    const shelves: Shelf[] = [];
    if (cont?.length) shelves.push({ id: "continue", title: "Continue Watching", kind: "continue", items: cont });
    if (nextUp?.length) shelves.push({ id: "nextUp", title: "Up Next", kind: "continue", items: nextUp });
    if (watchlist?.length) shelves.push({ id: "watchlist", title: "My List", kind: "titles", items: watchlist });
    return shelves;
  }

  /** Home's rails that are the same for everyone: the hero, recently added and trending. */
  async homeCatalog(): Promise<Shelf[]> {
    const shelves: Shelf[] = [];
    const safe = homeSafe;

    // Anime gets rails of its own on Home: it's left out of the movie and show rails.
    // Usually instant (the list is cached); never hold Home up for long on a slow load.
    // A load that outlasts the wait carries on in the background, tied to this request (on
    // Workers its database connection stays open until it's done).
    let timer: Timer | undefined;
    const loading = this.anime?.ids.ready().catch(() => {});
    if (loading) runtime.background(loading);
    await Promise.race([loading, new Promise<void>((resolve) => (timer = setTimeout(resolve, 1_500)))]);
    clearTimeout(timer);
    const isAnimeShow = (i: TmdbListItem) => this.isAnimeItem("show", i);
    const isAnimeFilm = (i: TmdbListItem) => this.isAnimeItem("movie", i);
    const [trendingMovieList, trendingShows, trendingAnimeShows] = await Promise.all([
      safe("trendingMovies", async () => (await this.tmdb.trending("movie")).results),
      safe("trendingShows", async () => await this.cards((await this.tmdb.trending("tv")).results.filter((i) => !isAnimeShow(i)), "show")),
      safe("trendingAnime", () => this.trendingThisWeek("show", isAnimeShow, ANIME_DISCOVER)),
    ]);
    const trendingMovies = trendingMovieList ? await this.cards(trendingMovieList.filter((i) => !isAnimeFilm(i)), "movie") : null;
    // Anime films trending this week join the anime shows, every third card.
    const animeFilms = trendingMovieList ? await this.cards(trendingMovieList.filter(isAnimeFilm), "movie") : [];
    const trendingAnime = interleave(trendingAnimeShows ?? [], animeFilms, 3).slice(0, 20);

    // "Recently Added" is the catalog's, not the library's: what's newly out to watch.
    // "New" is the catalog's, not the library's: what's newly out to watch. Shows get the
    // episodes that just aired, like the Anime tab's Latest Episodes; new anime only
    // reaches the hero (the Anime tab has its own).
    const [recentMovies, latestEpisodes, recentAnime] = await Promise.all([
      safe("recentMovies", () => this.newlyReleased("movie", (i) => !isAnimeFilm(i))).then((c) => c ?? []),
      safe("latestEpisodes", () => this.latestEpisodes((i) => !isAnimeShow(i))).then((c) => c ?? []),
      safe("recentAnime", () => this.newAnime()).then((c) => c ?? []),
    ]);

    const featured = await safe("featured", () =>
      this.featured([
        { label: "New Movie", cards: recentMovies, take: 2 },
        { label: "Trending Movie", cards: trendingMovies ?? [], take: 3 },
        { label: "Trending Show", cards: trendingShows ?? [], take: 2 },
        { label: "Trending Anime", cards: trendingAnime, take: 2 },
        { label: "New Episode", cards: latestEpisodes, take: 1 },
        { label: "New Anime", cards: recentAnime, take: 1 },
      ]),
    );
    if (featured?.length) shelves.push({ id: "featured", title: "Featured", kind: "titles", items: featured });
    if (latestEpisodes.length) shelves.push({ id: "latestEpisodes", title: "Latest Episodes", kind: "titles", items: latestEpisodes });
    if (recentMovies.length) shelves.push({ id: "recentMovies", title: "New Movies", kind: "titles", items: recentMovies });
    if (trendingMovies?.length) shelves.push({ id: "trendingMovies", title: "Trending Movies", kind: "titles", items: trendingMovies });
    if (trendingShows?.length) shelves.push({ id: "trendingShows", title: "Trending Shows", kind: "titles", items: trendingShows });
    if (trendingAnime.length) shelves.push({ id: "trendingAnime", title: "Trending Anime", kind: "titles", items: trendingAnime });
    return shelves;
  }

  /**
   * The Home hero carousel: a few titles from each source, taken in turns so the
   * carousel alternates between them. Each needs a backdrop; library titles are
   * filled out from TMDB (they're stored without an overview).
   */
  private async featured(sources: { label: string; cards: TitleCard[]; take: number }[]): Promise<TitleCard[]> {
    const picks = await Promise.all(
      sources.map(async (src) => {
        const candidates = src.cards.filter((c) => c.backdropUrl).slice(0, src.take);
        // Each card is filled out by its own type: a source can mix series and films,
        // and a TMDB id means a different title in each.
        const full = await Promise.all(
          candidates.map(async (c) => (c.overview || !c.tmdbId ? c : ((await this.detailCards(c.type, [c.tmdbId]))[0] ?? null))),
        );
        // The hero fills the screen: list cards carry a w780 backdrop, too soft at that size.
        return full
          .filter((c): c is TitleCard => !!c?.backdropUrl)
          .map((c) => ({ ...c, backdropUrl: c.backdropUrl!.replace(/\/t\/p\/w\d+\//, "/t/p/original/"), eyebrow: src.label }));
      }),
    );
    const seen = new Set<string>();
    const out: TitleCard[] = [];
    for (let round = 0; picks.some((p) => p.length > round); round++) {
      for (const list of picks) {
        const card = list[round];
        if (!card || seen.has(card.ref)) continue;
        seen.add(card.ref);
        out.push(card);
      }
    }
    return out.slice(0, 10);
  }

  async browse(type: TitleType, list: BrowseList): Promise<TitleCard[]> {
    if (list === "library") return await this.libraryCards(type, 500);
    if (list === "latestReleases" || list === "inTheaters") {
      if (type !== "movie") return [];
      return await this.cards(list === "latestReleases" ? await this.latestReleases() : await this.inTheaters(), "movie");
    }
    const tmdbType = type === "movie" ? "movie" : "tv";
    const page = list === "trending" ? await this.tmdb.trending(tmdbType) : list === "popular" ? await this.tmdb.popular(tmdbType) : await this.tmdb.topRated(tmdbType);
    return await this.cards(page.results, type);
  }

  /**
   * Films out to rent or buy in the last 60 days, newest digital release first, by the
   * household's region's dates. Older films back as a new digital release, and ones
   * hardly anyone is watching, are left out.
   */
  private async latestReleases(): Promise<TmdbListItem[]> {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        this.tmdb
          .discover("movie", {
            region: this.settings().region,
            with_release_type: "4",
            "release_date.gte": day(60),
            "release_date.lte": day(0),
            "primary_release_date.gte": day(365),
            "with_runtime.gte": "60",
            sort_by: "release_date.desc",
            page: String(page),
          })
          .then((r) => r.results)
          .catch(() => [] as TmdbListItem[]),
      ),
    );
    return dedupe(pages.flat()).filter((m) => (m.popularity ?? 0) >= MIN_RELEASE_POPULARITY).slice(0, 40);
  }

  /** Films in the household's region's cinemas now, newest release first. */
  private async inTheaters(): Promise<TmdbListItem[]> {
    const region = this.settings().region;
    const pages = await Promise.all([1, 2, 3].map((page) => this.tmdb.nowPlaying(region, page).then((r) => r.results).catch(() => [] as TmdbListItem[])));
    return dedupe(pages.flat())
      .filter((m) => (m.popularity ?? 0) >= MIN_RELEASE_POPULARITY)
      .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "") || (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 40);
  }

  /** TMDB's genres. Anime has its own tab (see `animePage`). */
  async genres(type: TitleType): Promise<{ id: number; name: string }[]> {
    return (await this.tmdb.genres(type === "movie" ? "movie" : "tv")).genres;
  }

  /** Rails for one genre: new, popular and top rated on TMDB. */
  async genreShelves(type: TitleType, genreId: number): Promise<Shelf[]> {
    // Older apps still list "Anime" under Movies/Shows: its half of the Anime page.
    if (genreId === ANIME_GENRE_ID) {
      const page = await this.animePage();
      const half = page.filter((s) => (type === "movie" ? s.id.startsWith("anime-films") : !s.id.startsWith("anime-films")));
      if (half.length) return half;
    }
    const tmdbType = type === "movie" ? "movie" : "tv";
    const today = new Date().toISOString().slice(0, 10);
    const dateKey = type === "movie" ? "primary_release_date" : "first_air_date";
    const filter = genreId === ANIME_GENRE_ID ? ANIME_DISCOVER : { with_genres: String(genreId) };
    const discover = (params: Record<string, string>) =>
      this.tmdb.discover(tmdbType, { ...filter, ...params }).then((p) => this.cards(p.results, type));
    const safe = <T,>(work: Promise<T[]>) => work.catch((err) => (log.warn("Genre shelf failed", err), [] as T[]));
    const [trending, popular, topRated, fresh] = await Promise.all([
      safe(this.trendingThisWeek(type, (i) => i.genre_ids?.includes(genreId) ?? false, filter)),
      safe(discover({ sort_by: "popularity.desc" })),
      safe(discover({ sort_by: "vote_average.desc", "vote_count.gte": "300" })),
      safe(discover({ sort_by: `${dateKey}.desc`, [`${dateKey}.lte`]: today, "vote_count.gte": "20" })),
    ]);
    const shelves: Shelf[] = [];
    if (trending.length) shelves.push({ id: "trending", title: "Trending", kind: "titles", items: trending });
    if (fresh.length) shelves.push({ id: "new", title: "New", kind: "titles", items: fresh });
    if (popular.length) shelves.push({ id: "popular", title: "Popular", kind: "titles", items: popular });
    if (topRated.length) shelves.push({ id: "topRated", title: "Top Rated", kind: "titles", items: topRated });
    return shelves;
  }

  /**
   * TMDB's trending this week, narrowed to what `keep` accepts. Narrow genres rarely
   * fill a rail from the overall chart, so it's topped up with the genre's most popular
   * titles out this week (shows with an episode in the last 7 days, films in the last 60).
   */
  private async trendingThisWeek(type: TitleType, keep: (item: TmdbListItem) => boolean, discoverFilter: Record<string, string>): Promise<TitleCard[]> {
    const tmdbType = type === "movie" ? "movie" : "tv";
    const pages = await Promise.all([1, 2, 3].map((p) => this.tmdb.trending(tmdbType, p).then((r) => r.results).catch(() => [] as TmdbListItem[])));
    // The chart can repeat a title across pages.
    const seenIds = new Set<number>();
    const items = pages.flat().filter((i) => keep(i) && !seenIds.has(i.id) && seenIds.add(i.id));
    if (items.length < 12) {
      const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      const window: Record<string, string> =
        type === "movie" ? { "primary_release_date.gte": day(60), "primary_release_date.lte": day(0) } : { "air_date.gte": day(7), "air_date.lte": day(0) };
      const recent = await this.tmdb.discover(tmdbType, { ...discoverFilter, ...window, sort_by: "popularity.desc" }).then((r) => r.results).catch(() => [] as TmdbListItem[]);
      const seen = new Set(items.map((i) => i.id));
      items.push(...recent.filter((i) => !seen.has(i.id)));
    }
    return await this.cards(items.slice(0, 20), type);
  }

  /**
   * The Shows tab, laid out like the Anime tab: a spotlight of what's trending, the
   * trending top 10, episodes that just aired, then new, popular, top rated and coming
   * soon. Anime has its own tab, so it's left out.
   */
  async showsPage(): Promise<Shelf[]> {
    await this.anime?.ids.ready().catch(() => {});
    const keep = (i: TmdbListItem) => !this.isAnimeItem("show", i);
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    // Not daily talk, news or soaps: they "air" every day and would fill the rails.
    const discover = (params: Record<string, string>) =>
      this.tmdb
        .discover("tv", { without_genres: "10763,10766,10767", sort_by: "popularity.desc", ...params })
        .then((p) => this.cards(p.results.filter(keep), "show"))
        .catch(() => [] as TitleCard[]);
    const list = (work: Promise<{ results: TmdbListItem[] }>) => work.then((p) => this.cards(p.results.filter(keep), "show")).catch(() => [] as TitleCard[]);
    const [trending, latest, fresh, popular, topRated, soon] = await Promise.all([
      this.trendingThisWeek("show", keep, {}).catch(() => [] as TitleCard[]),
      this.latestEpisodes(keep).catch(() => [] as TitleCard[]),
      discover({ "first_air_date.gte": day(90), "first_air_date.lte": day(0), "vote_count.gte": "10" }),
      list(this.tmdb.popular("tv")),
      list(this.tmdb.topRated("tv")),
      discover({ "first_air_date.gte": day(-1), "first_air_date.lte": day(-90) }),
    ]);
    const spotlight = trending
      .filter((c) => c.backdropUrl && c.overview)
      .slice(0, 8)
      .map((c, i) => ({ ...c, eyebrow: `#${i + 1} in Shows` }));
    const shelves: Shelf[] = [
      { id: "shows-spotlight", title: "Spotlight", kind: "titles", style: "hero", items: spotlight },
      { id: "shows-trending", title: "Trending", kind: "titles", items: trending.slice(0, 10) },
      { id: "shows-latest-episodes", title: "Latest Episodes", kind: "titles", items: latest },
      { id: "shows-new", title: "New Shows", kind: "titles", items: fresh },
      { id: "shows-popular", title: "Popular", kind: "titles", items: popular },
      { id: "shows-top-rated", title: "Top Rated", kind: "titles", items: topRated },
      { id: "shows-coming-soon", title: "Coming Soon", kind: "titles", items: soon },
    ];
    return shelves.filter((s) => s.items.length >= 3);
  }

  /**
   * Shows with an episode out in the last few days, most popular first, each labelled
   * with that episode ("S2 · E5", as the apps write it).
   */
  private async latestEpisodes(keep: (item: TmdbListItem) => boolean): Promise<TitleCard[]> {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const params = { sort_by: "popularity.desc", "air_date.gte": day(3), "air_date.lte": day(0), "vote_count.gte": "10", without_genres: "10763,10766,10767" };
    const pages = await Promise.all([1, 2].map((page) => this.tmdb.discover("tv", { ...params, page: String(page) }).then((p) => p.results).catch(() => [] as TmdbListItem[])));
    const seen = new Set<number>();
    const ids = pages
      .flat()
      .filter((i) => keep(i) && !seen.has(i.id) && seen.add(i.id))
      .slice(0, 24)
      .map((i) => i.id);
    // Details (cached) say which episode aired; the discover list doesn't.
    const shows = await Promise.all(ids.map((id) => this.tmdb.show(id).catch(() => null)));
    const label = new Map<number, string>();
    for (const show of shows) {
      const last = show?.last_episode_to_air;
      if (show && last?.air_date && last.air_date >= day(7)) label.set(show.id, `S${last.season_number} · E${last.episode_number}`);
    }
    return (await this.cards(shows.filter((s): s is TmdbShow => !!s && label.has(s.id)), "show"))
      .map((c) => ({ ...c, badge: label.get(c.tmdbId!) }))
      .slice(0, 20);
  }

  /** The Anime tab's categories (Kitsu's). */
  animeCategories() {
    return ANIME_CATEGORIES;
  }

  /**
   * The Anime tab: what's trending and airing, then series and films ranked by Kitsu.
   * With a category, its own popular and top rated series and films.
   */
  async animePage(category?: string): Promise<Shelf[]> {
    const { ids, kitsu } = this.anime ?? {};
    if (!ids) return [];
    await ids.ready();
    if (!category) {
      const sections = await this.animeSections().catch((err) => (log.warn("Anime sections failed", err), null));
      if (sections?.length) return sections;
    }
    if (!kitsu) return [];
    type Plan = { id: string; title: string; kind: "series" | "films"; rail: KitsuRail };
    const plans: Plan[] = category
      ? [
          { id: "anime-series-season", title: "This Season", kind: "series", rail: "season" },
          { id: "anime-series-popular", title: "Popular Shows", kind: "series", rail: "popular" },
          { id: "anime-series-top", title: "Top Rated Shows", kind: "series", rail: "top" },
          { id: "anime-films-popular", title: "Popular Movies", kind: "films", rail: "popular" },
          { id: "anime-films-top", title: "Top Rated Movies", kind: "films", rail: "top" },
        ]
      : [
          { id: "anime-series-season", title: "This Season", kind: "series", rail: "season" },
          { id: "anime-series-top", title: "Top Rated Shows", kind: "series", rail: "top" },
          { id: "anime-films-recent", title: "New Movies", kind: "films", rail: "recent" },
          { id: "anime-series-lastSeason", title: "Last Season", kind: "series", rail: "lastSeason" },
          { id: "anime-series-popular", title: "All-Time Popular", kind: "series", rail: "popular" },
          { id: "anime-films-popular", title: "Popular Movies", kind: "films", rail: "popular" },
          { id: "anime-films-top", title: "Top Rated Movies", kind: "films", rail: "top" },
        ];
    const isAnime = (i: TmdbListItem) => this.isAnimeItem("show", i);
    const [trending, ...ranked] = await Promise.all([
      category ? Promise.resolve([] as TitleCard[]) : this.trendingThisWeek("show", isAnime, ANIME_DISCOVER).catch(() => [] as TitleCard[]),
      ...plans.map(async (plan): Promise<Shelf> => {
        const type: TitleType = plan.kind === "films" ? "movie" : "show";
        const kitsuIds = await kitsu.rail(plan.kind, plan.rail, { category });
        // Several Kitsu entries (seasons, cours) are one TMDB show: keep its best rank.
        const tmdbIds = [...new Set(kitsuIds.map((k) => (type === "movie" ? ids.kitsu(k)?.tmdbMovie : ids.kitsu(k)?.tmdbTv)).filter((id): id is number => !!id))];
        return { id: plan.id, title: plan.title, kind: "titles", items: await this.detailCards(type, tmdbIds) };
      }),
    ]);
    const shelves = ranked.filter((s) => s.items.length >= 3);
    if (trending.length >= 3) shelves.unshift({ id: "anime-series-trending", title: "Trending", kind: "titles", items: trending });
    return shelves;
  }

  /**
   * The Anime tab from AniList's lists: a spotlight of what's trending, then rails of the
   * trending top 10, episodes aired in the last two days, top airing, most popular, most
   * favourited, recently completed and the most anticipated upcoming titles. Each rail
   * links to its full list.
   */
  private async animeSections(): Promise<Shelf[] | null> {
    const home = await this.anime?.anilist.home();
    if (!home) return null;
    const [trending, ...rails] = await Promise.all([
      this.anilistCards(home.trending, 20),
      ...ANIME_LISTS.map(async (list): Promise<Shelf> => {
        const items = await this.anilistCards(home[list.id], list.rail, list.badge);
        return { id: `anime-${list.slug}`, title: animeListTitle(list, home.currentSeason), kind: "titles", items, more: list.id };
      }),
    ]);
    const spotlight = (await this.withTmdbBackdrops(trending.filter((c) => c.overview).slice(0, 12)))
      .filter((c) => c.backdropUrl)
      .slice(0, 8)
      .map((c, i) => ({ ...c, eyebrow: `#${i + 1} in Anime` }));
    const shelves: Shelf[] = [
      { id: "anime-spotlight", title: "Spotlight", kind: "titles", style: "hero", items: spotlight },
      { id: "anime-trending", title: "Trending", kind: "titles", items: trending.slice(0, 10), more: "trending" },
      ...rails,
    ];
    return shelves.filter((s) => s.items.length >= 3);
  }

  /** One of the Anime tab's lists in full ("See all"), or null for one it doesn't have. */
  async animeList(id: string): Promise<{ title: string; items: TitleCard[] } | null> {
    const list = id === "trending" ? { id, title: "Trending", badge: undefined } : ANIME_LISTS.find((l) => l.id === id);
    const anilist = this.anime?.anilist;
    if (!list || !anilist) return null;
    await this.anime!.ids.ready();
    // Latest Episodes is already every episode of the last two days.
    const items = list.id === "latest" ? (await anilist.home())?.latest : await anilist.list(list.id as AnilistRankedList);
    if (!items) throw new Error("AniList is unavailable");
    return { title: animeListTitle(list, seasonOf(new Date())), items: await this.anilistCards(items, 50, list.badge) };
  }

  /**
   * Cards for AniList titles, from AniList's own data, in its order: every entry is its
   * own title (a sequel or a later cour too), none left out for want of a TMDB match.
   * `tmdbId` is there when Fribb's list maps the entry to TMDB.
   */
  private async anilistCards(items: AnilistHomeItem[], limit: number, badge?: (i: AnilistHomeItem, laterSeason: boolean) => string | undefined): Promise<TitleCard[]> {
    const ids = this.anime!.ids;
    const picked = items.slice(0, limit);
    const refs = picked.map((i): TitleRef => ({ source: "anilist", type: i.format === "MOVIE" ? "movie" : "show", id: i.id }));
    const avail = await this.library.availability(refs);
    return picked.map((item, n) => {
      const ref = refs[n]!;
      const entry = ids.anilist(item.id);
      const tmdbId = ref.type === "movie" ? entry?.tmdbMovie : entry?.tmdbTv;
      // A sequel or a later cour: TMDB counts it as part of the show.
      const laterSeason = ref.type === "show" && !!entry && ((entry.tmdbSeason ?? 1) > 1 || entry.tmdbOffset > 0);
      const label = badge?.(item, laterSeason);
      return {
        type: ref.type,
        ref: formatRef(ref),
        ...(tmdbId ? { tmdbId } : {}),
        title: item.title?.english?.trim() || item.title?.romaji?.trim() || "",
        year: item.seasonYear ?? null,
        overview: plainDescription(item.description),
        posterUrl: item.coverImage?.extraLarge ?? item.coverImage?.large ?? null,
        backdropUrl: item.bannerImage ?? null,
        ...(item.averageScore ? { rating: item.averageScore / 10 } : {}),
        available: avail.get(formatRef(ref)) ?? [],
        ...(label ? { badge: label } : {}),
      };
    });
  }

  /**
   * TMDB's backdrop, where it has the title, in place of AniList's banner: the hero fills
   * the screen, and AniList's banners are a thin strip.
   */
  private async withTmdbBackdrops(cards: TitleCard[]): Promise<TitleCard[]> {
    return Promise.all(
      cards.map(async (card) => {
        if (!card.tmdbId) return card;
        const detail = await (card.type === "movie" ? this.tmdb.movie(card.tmdbId) : this.tmdb.show(card.tmdbId)).catch(() => null);
        return detail?.backdrop_path ? { ...card, backdropUrl: imageUrl(detail.backdrop_path, "original") } : card;
      }),
    );
  }

  /**
   * An AniList title's page, shaped like TMDB's (`movie`, `show`) so the apps show it the
   * same way: AniList's data, TMDB's backdrop where Fribb's list maps the title to TMDB,
   * Kitsu's rating. A show is one season, "Episodes"; other seasons are `related`. Null
   * when AniList doesn't have it (or can't answer), it's for adults, or `ref` has the
   * wrong type.
   */
  async anilistTitle(userId: string, ref: TitleRef) {
    const media = await this.anilistMedia(ref);
    if (!media) return null;
    const ids = this.anime!.ids;
    await ids.ready().catch(() => {});
    const entry = ids.anilist(media.id);
    const tmdbId = ref.type === "movie" ? entry?.tmdbMovie : entry?.tmdbTv;
    const [backdropUrl, certification, recommendations, related] = await Promise.all([
      this.tmdbBackdrop(ref.type, tmdbId).then((url) => url ?? media.bannerImage ?? null),
      this.anilistCertification(ref),
      this.anilistCards((media.recommendations?.nodes ?? []).map((n) => n.mediaRecommendation).filter((m) => !!m && m.type === "ANIME" && !m.isAdult) as AnilistHomeItem[], 20),
      this.relatedCards(media),
    ]);
    const studios = media.studios?.nodes.filter((s) => s.isAnimationStudio).map((s) => s.name) ?? [];
    const trailerKey = media.trailer?.site === "youtube" && media.trailer.id ? media.trailer.id : null;
    const common = {
      ref: formatRef(ref),
      ...(tmdbId ? { tmdbId } : {}),
      imdbId: null,
      title: media.title.english?.trim() || media.title.romaji?.trim() || "",
      tagline: null,
      overview: plainDescription(media.description) ?? "",
      year: media.seasonYear ?? media.startDate?.year ?? null,
      genres: media.genres ?? [],
      rating: media.averageScore ? media.averageScore / 10 : null,
      ratings: null,
      certification,
      posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      backdropUrl,
      cast: [] as ReturnType<typeof castOf>,
      trailer: trailerKey ? { site: "youtube", key: trailerKey, name: "Trailer" } : null,
      videos: trailerKey ? [youtubeVideo(trailerKey, "Trailer", "Trailer")] : [],
      recommendations,
      /** Other seasons, films and spin-offs: sequels first. */
      related,
      anime: {
        anilistId: media.id,
        romaji: media.title.romaji ?? null,
        native: media.title.native ?? null,
        studios,
        score: media.averageScore ?? null,
        nextEpisode: media.nextAiringEpisode ? { episode: media.nextAiringEpisode.episode, airsAt: media.nextAiringEpisode.airingAt * 1000 } : null,
      },
    };
    if (ref.type === "movie") {
      const target = { source: "anilist" as const, mediaType: "movie" as const, titleId: ref.id };
      const sources = await findCandidates(this.library, this.settings(), target);
      return {
        type: "movie" as const,
        ...common,
        releaseDate: isoDate(media.startDate),
        runtimeMinutes: media.duration ?? null,
        directors: [] as string[],
        collection: null,
        available: [...new Set(sources.map((s) => s.provider))],
        sources,
        progress: progressDto(await this.progress.get(userId, target)),
        inWatchlist: await this.progress.inWatchlist(userId, ref),
      };
    }
    const [files, watched] = await Promise.all([this.library.filesFor(ref), this.progress.forShow(userId, ref)]);
    const aired = airedEpisodes(media);
    const episodeCount = Math.min(MAX_ANILIST_EPISODES, media.episodes ?? aired);
    return {
      type: "show" as const,
      ...common,
      firstAirDate: isoDate(media.startDate),
      lastAirDate: media.status === "FINISHED" ? isoDate(media.endDate) : null,
      status: showStatus(media.status),
      seasons:
        episodeCount > 0
          ? [
              {
                season: 1,
                name: "Episodes",
                episodeCount,
                airDate: isoDate(media.startDate),
                posterUrl: common.posterUrl,
                availableEpisodes: new Set(files.filter((f) => f.season === 1).map((f) => f.episode)).size,
              },
            ]
          : [],
      available: [...new Set(files.map((f) => f.provider))],
      /** Where the Play button should go: an in-progress episode, else the next unwatched one. */
      upNext: anilistUpNext(files, watched, aired, episodeCount),
      inWatchlist: await this.progress.inWatchlist(userId, ref),
    };
  }

  /**
   * An AniList show's one season, shaped like `season`. Episodes are AniList's numbers;
   * where Fribb's list maps the title to TMDB, names, synopses, stills and air dates come
   * from TMDB's matching episodes. Episodes still to come are listed up to the announced
   * count. Null for any other season, or a title `anilistTitle` wouldn't show.
   */
  async anilistSeason(userId: string, ref: TitleRef, seasonNumber: number) {
    if (ref.type !== "show" || seasonNumber !== 1) return null;
    const media = await this.anilistMedia(ref);
    if (!media) return null;
    const aired = airedEpisodes(media);
    const upcoming = new Map((media.airingSchedule?.nodes ?? []).map((n) => [n.episode, n.airingAt]));
    const count = Math.min(MAX_ANILIST_EPISODES, Math.max(aired, media.episodes ?? 0));
    const numbers = Array.from({ length: count }, (_, i) => i + 1);
    const [tmdbEpisodes, files, progress] = await Promise.all([
      this.tmdbEpisodesFor(media.id, numbers).catch((err) => (log.warn(`TMDB episodes for AniList ${media.id} failed`, err), new Map<number, TmdbEpisode>())),
      this.library.filesFor(ref, 1),
      this.progress.forShow(userId, ref),
    ]);
    const watched = new Map(progress.filter((p) => p.season === 1).map((p) => [p.episode, p]));
    return {
      season: 1,
      name: "Episodes",
      overview: "",
      airDate: isoDate(media.startDate),
      posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      episodes: numbers.map((n) => {
        const tmdb = tmdbEpisodes.get(n);
        const airsAt = upcoming.get(n);
        return {
          season: 1,
          episode: n,
          name: tmdb?.name || `Episode ${n}`,
          overview: tmdb?.overview ?? "",
          airDate: airsAt ? new Date(airsAt * 1000).toISOString().slice(0, 10) : (tmdb?.air_date ?? null),
          runtimeMinutes: media.duration ?? tmdb?.runtime ?? null,
          stillUrl: imageUrl(tmdb?.still_path, "w780"),
          rating: tmdb?.vote_average ?? null,
          imdbRating: null,
          available: [...new Set(files.filter((f) => f.episode === n).map((f) => f.provider))],
          progress: progressDto(watched.get(n)),
        };
      }),
    };
  }

  /** AniList's data for a title page, or null (see `anilistTitle`). */
  private async anilistMedia(ref: TitleRef): Promise<AnilistTitle | null> {
    if (ref.source !== "anilist" || !this.anime) return null;
    const media = await this.anime.anilist.title(ref.id);
    if (!media || media.isAdult) return null;
    return (media.format === "MOVIE" ? "movie" : "show") === ref.type ? media : null;
  }

  /** The title's rating as text (Kitsu's, else TMDB's); like OMDb, the page waits at most 1.5s. */
  private anilistCertification(ref: TitleRef): Promise<string | null> {
    const { ids, kitsu } = this.anime!;
    const lookup = animeRating(ref.type, ref.id, { ids, kitsu, tmdb: this.tmdb, region: this.settings().region }).then((r) => r.certification);
    return Promise.race([lookup.catch(() => null), runtime.sleep(1_500).then(() => null)]);
  }

  /** TMDB's backdrop for a title, or null. */
  private async tmdbBackdrop(type: TitleType, tmdbId: number | undefined): Promise<string | null> {
    if (!tmdbId) return null;
    const detail = await (type === "movie" ? this.tmdb.movie(tmdbId) : this.tmdb.show(tmdbId)).catch(() => null);
    return imageUrl(detail?.backdrop_path, "w1280");
  }

  /** Cards for a title's other seasons, films and spin-offs, sequels first, each labelled. */
  private async relatedCards(media: AnilistTitle): Promise<TitleCard[]> {
    const edges = (media.relations?.edges ?? [])
      .filter((e) => e.node && e.node.type === "ANIME" && !e.node.isAdult && e.node.format !== "MUSIC" && RELATION_LABELS[e.relationType ?? ""])
      .sort((a, b) => RELATION_ORDER.indexOf(a.relationType!) - RELATION_ORDER.indexOf(b.relationType!));
    const label = new Map(edges.map((e) => [e.node!.id, RELATION_LABELS[e.relationType!]]));
    return this.anilistCards(
      edges.map((e) => e.node!),
      30,
      (i) => label.get(i.id),
    );
  }

  /**
   * TMDB's episodes for an AniList show's episodes 1…n, where Fribb's list maps it: its
   * TMDB season from its offset, or numbered across TMDB's seasons when it has none.
   */
  private async tmdbEpisodesFor(anilistId: number, numbers: number[]): Promise<Map<number, TmdbEpisode>> {
    const entry = this.anime!.ids.anilist(anilistId);
    const out = new Map<number, TmdbEpisode>();
    if (!entry?.tmdbTv || !numbers.length) return out;
    const showId = entry.tmdbTv;
    // One TMDB season, or (numbered absolutely) only the seasons TMDB's show has: episodes
    // past its last aren't looked for.
    const tmdbSeasons =
      entry.tmdbSeason !== undefined ? [] : (await this.tmdb.show(showId)).seasons.filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const placed = numbers.slice(0, MAX_ANILIST_EPISODES).flatMap((n) => {
      const at = tmdbEpisodeOf(entry, n, tmdbSeasons);
      return at ? [[n, at] as const] : [];
    });
    const seasonNumbers = [...new Set(placed.map(([, p]) => p.season))];
    const seasons = new Map(
      await Promise.all(seasonNumbers.map(async (s) => [s, await this.tmdb.season(showId, s).catch(() => null)] as const)),
    );
    for (const [n, p] of placed) {
      const ep = seasons.get(p.season)?.episodes.find((e) => e.episode_number === p.episode);
      if (ep) out.set(n, ep);
    }
    return out;
  }


  /** Cards from TMDB details (cached), a few lookups at a time; ones that fail are left out. */
  private async detailCards(type: TitleType, tmdbIds: number[]): Promise<TitleCard[]> {
    const details: (TmdbListItem | null)[] = new Array(tmdbIds.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < tmdbIds.length) {
        const i = next++;
        const id = tmdbIds[i]!;
        details[i] = await (type === "movie" ? this.tmdb.movie(id) : this.tmdb.show(id)).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, tmdbIds.length) }, worker));
    // One availability query for the lot, not one per card.
    return await this.cards(details.filter((d): d is TmdbListItem => d !== null), type);
  }

  /** A cast or crew member and the movies and shows they're known for, most popular first. */
  async person(id: number) {
    const p = await this.tmdb.person(id);
    const acting = (p.known_for_department ?? "Acting") === "Acting";
    const credits = acting ? p.combined_credits?.cast ?? [] : p.combined_credits?.crew.filter((c) => c.job === "Director" || c.job === "Creator" || c.job === "Writer") ?? [];
    const seen = new Set<string>();
    const ranked = credits
      .filter((c) => (c.media_type === "movie" || c.media_type === "tv") && !(c.media_type === "tv" && c.character?.includes("Self")))
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0))
      .filter((c) => {
        const key = `${c.media_type}-${c.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const role = new Map(ranked.map((c) => [`${c.media_type}-${c.id}`, c.character || c.job || null]));
    const withRole = (cards: TitleCard[], t: string) => cards.map((card) => ({ ...card, role: role.get(`${t}-${card.tmdbId}`) ?? null }));
    return {
      id: p.id,
      name: p.name,
      biography: p.biography || null,
      birthday: p.birthday ?? null,
      deathday: p.deathday ?? null,
      placeOfBirth: p.place_of_birth ?? null,
      knownFor: p.known_for_department ?? null,
      profileUrl: imageUrl(p.profile_path, "w500"),
      movies: withRole(await this.cards(ranked.filter((c) => c.media_type === "movie").slice(0, 40), "movie"), "movie"),
      shows: withRole(await this.cards(ranked.filter((c) => c.media_type === "tv").slice(0, 40), "show"), "tv"),
    };
  }

  async search(query: string): Promise<TitleCard[]> {
    const page = await this.tmdb.searchMulti(query);
    const movies = page.results.filter((r) => r.media_type === "movie");
    const shows = page.results.filter((r) => r.media_type === "tv");
    const movieCards = await this.cards(movies, "movie");
    const showCards = await this.cards(shows, "show");
    // Keep TMDB's relevance order across both types.
    return page.results.flatMap((r) => (r.media_type === "movie" ? movieCards.filter((c) => c.tmdbId === r.id) : r.media_type === "tv" ? showCards.filter((c) => c.tmdbId === r.id) : []));
  }

  async movie(userId: string, id: number) {
    const m = await this.tmdb.movie(id);
    const imdbId = m.imdb_id ?? m.external_ids?.imdb_id ?? null;
    const [anime, ratings] = await Promise.all([this.animeInfo("movie", id).catch(() => null), this.ratings(imdbId)]);
    const ref = tmdbRef("movie", id);
    const sources = await findCandidates(this.library, this.settings(), { source: "tmdb", mediaType: "movie", titleId: id });
    const region = this.settings().region;
    const certification =
      m.release_dates?.results.find((r) => r.iso_3166_1 === region)?.release_dates.find((d) => d.certification)?.certification ?? null;
    return {
      type: "movie" as const,
      ref: formatRef(ref),
      tmdbId: m.id,
      imdbId,
      title: m.title,
      tagline: m.tagline || null,
      overview: m.overview ?? "",
      year: yearOf(m.release_date),
      releaseDate: m.release_date || null,
      runtimeMinutes: m.runtime ?? null,
      genres: m.genres.map((g) => g.name),
      rating: m.vote_average ?? null,
      /** IMDb and Rotten Tomatoes, when the server has an OMDb key. */
      ratings,
      certification,
      posterUrl: imageUrl(m.poster_path, "w500"),
      backdropUrl: imageUrl(m.backdrop_path, "w1280"),
      cast: castOf(m.credits),
      directors: m.credits?.crew.filter((c) => c.job === "Director").map((c) => c.name) ?? [],
      trailer: trailerOf(m.videos),
      videos: videosOf(m.videos),
      collection: m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name } : null,
      recommendations: await this.cards(m.recommendations?.results ?? [], "movie"),
      available: [...new Set(sources.map((s) => s.provider))],
      sources,
      progress: progressDto(await this.progress.get(userId, { source: "tmdb", mediaType: "movie", titleId: id })),
      inWatchlist: await this.progress.inWatchlist(userId, ref),
      anime,
    };
  }

  async show(userId: string, id: number) {
    const ref = tmdbRef("show", id);
    const s = await this.tmdb.show(id);
    const watched = await this.progress.forShow(userId, ref);
    const available = await this.library.filesFor(ref);
    const region = this.settings().region;
    const imdbId = s.external_ids?.imdb_id ?? null;
    const [anime, ratings, upNext] = await Promise.all([this.animeInfo("show", id).catch(() => null), this.ratings(imdbId), this.showUpNext(s, watched)]);
    return {
      type: "show" as const,
      ref: formatRef(ref),
      tmdbId: s.id,
      imdbId,
      title: s.name,
      tagline: s.tagline || null,
      overview: s.overview ?? "",
      year: yearOf(s.first_air_date),
      firstAirDate: s.first_air_date || null,
      lastAirDate: s.last_air_date || null,
      status: s.status ?? null,
      genres: s.genres.map((g) => g.name),
      rating: s.vote_average ?? null,
      /** IMDb and Rotten Tomatoes, when the server has an OMDb key. */
      ratings,
      certification: s.content_ratings?.results.find((r) => r.iso_3166_1 === region)?.rating || null,
      posterUrl: imageUrl(s.poster_path, "w500"),
      backdropUrl: imageUrl(s.backdrop_path, "w1280"),
      cast: castOf(s.credits),
      trailer: trailerOf(s.videos),
      videos: videosOf(s.videos),
      seasons: s.seasons.map((season) => ({
        season: season.season_number,
        name: season.name,
        episodeCount: season.episode_count,
        airDate: season.air_date ?? null,
        posterUrl: imageUrl(season.poster_path, "w342"),
        availableEpisodes: new Set(available.filter((f) => f.season === season.season_number).map((f) => f.episode)).size,
      })),
      recommendations: await this.cards(s.recommendations?.results ?? [], "show"),
      available: [...new Set(available.map((f) => f.provider))],
      /** Where the Play button should go: an in-progress episode, else the next unwatched one. */
      upNext,
      inWatchlist: await this.progress.inWatchlist(userId, ref),
      anime,
    };
  }

  async season(userId: string, showId: number, seasonNumber: number) {
    const [season, imdbRatings] = await Promise.all([this.tmdb.season(showId, seasonNumber), this.episodeRatings(showId, seasonNumber)]);
    const show = tmdbRef("show", showId);
    const files = await this.library.filesFor(show, seasonNumber);
    const watched = new Map((await this.progress.forShow(userId, show)).filter((p) => p.season === seasonNumber).map((p) => [p.episode, p]));
    return {
      season: season.season_number,
      name: season.name,
      overview: season.overview ?? "",
      airDate: season.air_date ?? null,
      posterUrl: imageUrl(season.poster_path, "w342"),
      episodes: season.episodes.map((e) => ({
        season: e.season_number,
        episode: e.episode_number,
        name: e.name,
        overview: e.overview ?? "",
        airDate: e.air_date ?? null,
        runtimeMinutes: e.runtime ?? null,
        stillUrl: imageUrl(e.still_path, "w780"),
        rating: e.vote_average ?? null,
        imdbRating: imdbRatings.get(e.episode_number) ?? null,
        available: [...new Set(files.filter((f) => f.episode === e.episode_number).map((f) => f.provider))],
        progress: progressDto(watched.get(e.episode_number)),
      })),
    };
  }

  sources(target: TitleTarget): Promise<Candidate[]> {
    return findCandidates(this.library, this.settings(), target);
  }

  private async continueWatching(userId: string): Promise<ContinueCard[]> {
    const hidden = await this.progress.hiddenFilter(userId);
    const rows = (await this.progress.inProgress(userId)).filter((r) => !hidden(r));
    const cards = await Promise.all(rows.map((row) => this.continueCard(row).catch(() => null)));
    return cards.filter((c): c is ContinueCard => c !== null);
  }

  private async continueCard(row: ProgressRow): Promise<ContinueCard> {
    if (row.source === "anilist") {
      const ref = targetRef(row);
      const card = (await this.anilistRefCards([ref])).get(formatRef(ref));
      if (!card) throw new Error(`AniList has no ${ref.type} ${ref.id}`);
      const episode = row.mediaType === "episode" ? { episode: await this.anilistEpisodeRef(row.titleId, row.episode) } : {};
      return { ...card, ...episode, positionMs: row.positionMs, durationMs: row.durationMs };
    }
    if (row.mediaType === "movie") {
      const m = await this.tmdb.movie(row.titleId);
      return { ...(await this.movieCard(m)), positionMs: row.positionMs, durationMs: row.durationMs };
    }
    const show = await this.tmdb.show(row.titleId);
    const season = await this.tmdb.season(row.titleId, row.season);
    const ep = season.episodes.find((e) => e.episode_number === row.episode);
    return {
      ...(await this.showCard(show)),
      episode: { season: row.season, episode: row.episode, name: ep?.name ?? `Episode ${row.episode}`, stillUrl: imageUrl(ep?.still_path, "w780") },
      positionMs: row.positionMs,
      durationMs: row.durationMs,
    };
  }

  private async nextUp(userId: string): Promise<ContinueCard[]> {
    const inProgressShows = new Set((await this.progress.inProgress(userId, 100)).filter((r) => r.mediaType === "episode").map((r) => formatRef(targetRef(r))));
    const hidden = await this.progress.hiddenFilter(userId);
    const latest = (await this.progress.recentlyCompletedEpisodes(userId)).filter((r) => !inProgressShows.has(formatRef(targetRef(r))) && !hidden(r));
    const cards = await Promise.all(
      latest.map(async (row) => {
        try {
          if (row.source === "anilist") return await this.anilistNextUp(userId, row);
          const show = await this.tmdb.show(row.titleId);
          const next = await this.episodeAfter(show, row.season, row.episode);
          if (!next) return null;
          const done = await this.progress.get(userId, { source: row.source, mediaType: "episode", titleId: row.titleId, season: next.season, episode: next.episode });
          if (done?.completed) return null;
          return { ...(await this.showCard(show)), episode: next, positionMs: 0, durationMs: 0 } satisfies ContinueCard;
        } catch {
          return null;
        }
      }),
    );
    return cards.filter((c) => c !== null) as ContinueCard[];
  }

  /**
   * The aired episode after S{season}E{episode}: TMDB's, crossing into the next season;
   * an AniList show's next episode in its one season.
   */
  async nextEpisode(show: TitleRef, season: number, episode: number): Promise<EpisodeRef | null> {
    if (show.source === "anilist") {
      const media = await this.anilistMedia(show);
      if (!media || season !== 1 || episode + 1 > airedEpisodes(media)) return null;
      return this.anilistEpisodeRef(show.id, episode + 1);
    }
    return this.episodeAfter(await this.tmdb.show(show.id), season, episode);
  }

  /** Up Next for an AniList show: the episode after the furthest one watched, once it's out. */
  private async anilistNextUp(userId: string, row: ProgressRow): Promise<ContinueCard | null> {
    const ref = targetRef(row);
    const media = await this.anilistMedia(ref);
    if (!media || row.season !== 1 || row.episode + 1 > airedEpisodes(media)) return null;
    const next = row.episode + 1;
    const done = await this.progress.get(userId, { source: "anilist", mediaType: "episode", titleId: row.titleId, season: 1, episode: next });
    if (done?.completed) return null;
    const [card] = await this.anilistCards([media], 1);
    if (!card) return null;
    return { ...card, episode: await this.anilistEpisodeRef(row.titleId, next), positionMs: 0, durationMs: 0 };
  }

  /** An AniList show's episode, named (and pictured) from TMDB's where the id list maps it. */
  private async anilistEpisodeRef(anilistId: number, episode: number): Promise<EpisodeRef> {
    const tmdb = (await this.tmdbEpisodesFor(anilistId, [episode]).catch(() => null))?.get(episode);
    return { season: 1, episode, name: tmdb?.name || `Episode ${episode}`, stillUrl: imageUrl(tmdb?.still_path, "w780") };
  }

  /** Cards for AniList titles, by `formatRef`, from AniList's (cached) data; ones it can't answer for are left out. */
  private async anilistRefCards(refs: TitleRef[]): Promise<Map<string, TitleCard>> {
    if (!this.anime || !refs.length) return new Map();
    await this.anime.ids.ready().catch(() => {});
    const media = (await Promise.all(refs.map((r) => this.anilistMedia(r).catch(() => null)))).filter((m): m is AnilistTitle => !!m);
    const cards = await this.anilistCards(media, media.length);
    return new Map(cards.map((c) => [c.ref, c]));
  }

  private async episodeAfter(show: TmdbShow, season: number, episode: number): Promise<EpisodeRef | null> {
    const today = new Date().toISOString().slice(0, 10);
    const current = await this.tmdb.season(show.id, season);
    let next = current.episodes.find((e) => e.episode_number === episode + 1);
    if (!next) {
      const following = show.seasons.filter((s) => s.season_number > season && s.season_number > 0).sort((a, b) => a.season_number - b.season_number)[0];
      if (!following) return null;
      next = (await this.tmdb.season(show.id, following.season_number)).episodes[0];
    }
    if (!next || !next.air_date || next.air_date > today) return null;
    return { season: next.season_number, episode: next.episode_number, name: next.name, stillUrl: imageUrl(next.still_path, "w780") };
  }

  /** `available`: the episode is in the library, so Play plays it (apps offer nothing else). */
  private async showUpNext(show: TmdbShow, watched: ProgressRow[]) {
    const files = (await this.library.filesFor(tmdbRef("show", show.id))).filter((f) => f.season !== null && f.episode !== null);
    const has = (season: number, episode: number) => files.some((f) => f.season === season && f.episode === episode);
    const at = (season: number, episode: number, positionMs = 0) => ({ season, episode, positionMs, available: has(season, episode) });
    const inProgress = watched.filter(isResumable).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (inProgress) return at(inProgress.season!, inProgress.episode!, inProgress.positionMs);
    const furthest = watched.filter((w) => w.completed).sort((a, b) => b.season! - a.season! || b.episode! - a.episode!)[0];
    if (furthest) {
      const next = await this.episodeAfter(show, furthest.season!, furthest.episode!).catch(() => null);
      if (next) return at(next.season, next.episode);
    }
    // Nothing watched yet: the first episode the library has, else the show's first.
    const firstOwned = files.filter((f) => f.season! > 0).sort((a, b) => a.season! - b.season! || a.episode! - b.episode!)[0];
    if (firstOwned) return at(firstOwned.season!, firstOwned.episode!);
    const first = show.seasons.filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number)[0];
    return first ? at(first.season_number, 1) : null;
  }

  /** The titles on this person's list (My List), newest first. */
  async watchlist(userId: string): Promise<TitleCard[]> {
    const rows = await this.progress.watchlist(userId);
    const anilist = await this.anilistRefCards(rows.filter((r) => r.source === "anilist").map((r) => ({ source: r.source, type: r.type, id: r.titleId })));
    const cards = await Promise.all(
      rows.map(async (r) => {
        if (r.source === "anilist") return anilist.get(formatRef({ source: r.source, type: r.type, id: r.titleId })) ?? null;
        try {
          return r.type === "movie" ? await this.movieCard(await this.tmdb.movie(r.titleId)) : await this.showCard(await this.tmdb.show(r.titleId));
        } catch {
          return null;
        }
      }),
    );
    return cards.filter((c): c is TitleCard => c !== null);
  }

  /** Library titles, newest first (by when their files were added). */
  private async libraryCards(type: TitleType, limit = 20): Promise<TitleCard[]> {
    // AniList titles carry their artwork as full URLs (see imageUrl), and TMDB's id where
    // the anime id list maps them, for apps from before refs.
    const items = await this.library.recentlyAdded(type, limit);
    const ids = this.anime?.ids;
    if (ids && items.some((i) => i.source === "anilist")) await ids.ready().catch(() => {});
    const tmdbIdOf = (i: (typeof items)[number]) => {
      if (i.source === "tmdb") return i.titleId;
      const entry = ids?.anilist(i.titleId);
      return type === "movie" ? entry?.tmdbMovie : entry?.tmdbTv;
    };
    const titleRefs = items.map((i): TitleRef => ({ source: i.source, type, id: i.titleId }));
    const refs = titleRefs.map(formatRef);
    const avail = await this.library.availability(titleRefs);
    return items.map((i, n) => ({
      type,
      ref: refs[n]!,
      ...(tmdbIdOf(i) ? { tmdbId: tmdbIdOf(i) } : {}),
      title: i.title,
      year: i.year,
      posterUrl: imageUrl(i.posterPath, "w342"),
      backdropUrl: imageUrl(i.backdropPath, "w780"),
      available: avail.get(refs[n]!) ?? [],
    }));
  }

  /**
   * Newly out to watch, most popular first: films released digitally or on disc in the
   * last 60 days, and shows with an episode out this week.
   */
  private async newlyReleased(type: TitleType, keep: (item: TmdbListItem) => boolean): Promise<TitleCard[]> {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const params: Record<string, string> =
      type === "movie"
        ? { sort_by: "popularity.desc", "release_date.gte": day(60), "release_date.lte": day(0), with_release_type: "4|5", "vote_count.gte": "10" }
        : // Not daily talk, news or soaps: they "air" every day and would fill the rail.
          { sort_by: "popularity.desc", "air_date.gte": day(7), "air_date.lte": day(0), "vote_count.gte": "10", without_genres: "10763,10766,10767" };
    const tmdbType = type === "movie" ? "movie" : "tv";
    const pages = await Promise.all([1, 2].map((page) => this.tmdb.discover(tmdbType, { ...params, page: String(page) }).then((p) => p.results).catch(() => [] as TmdbListItem[])));
    const seen = new Set<number>();
    return await this.cards(pages.flat().filter((i) => keep(i) && !seen.has(i.id) && seen.add(i.id)).slice(0, 20), type);
  }

  /** New anime: this season's series as Kitsu ranks them, with recent anime films mixed in. */
  private async newAnime(): Promise<TitleCard[]> {
    const { ids, kitsu } = this.anime ?? {};
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const [series, films] = await Promise.all([
      ids && kitsu
        ? kitsu.rail("series", "season").then((ranked) =>
            this.detailCards("show", [...new Set(ranked.map((k) => ids.kitsu(k)?.tmdbTv).filter((id): id is number => !!id))]),
          )
        : Promise.resolve([] as TitleCard[]),
      this.tmdb
        .discover("movie", { ...ANIME_DISCOVER, sort_by: "popularity.desc", "release_date.gte": day(120), "release_date.lte": day(0), with_release_type: "4|5" })
        .then((p) => this.cards(p.results, "movie"))
        .catch(() => [] as TitleCard[]),
    ]);
    return interleave(series, films, 4).slice(0, 20);
  }

  /**
   * Anime in a TMDB list: Japanese animation, or a title on the anime id list
   * (Cyberpunk: Edgerunners is listed as English) unless TMDB says it's Chinese or
   * Korean animation, which the list includes but which isn't anime.
   */
  private isAnimeItem(type: TitleType, i: TmdbListItem): boolean {
    if (i.original_language === "ja" && (i.genre_ids?.includes(16) ?? false)) return true;
    return this.isAnimeTitle(type, i.id) && !NOT_ANIME_LANGUAGES.has(i.original_language ?? "");
  }

  private isAnimeTitle(type: TitleType, tmdbId: number): boolean {
    const ids = this.anime?.ids;
    if (!ids) return false;
    return type === "movie" ? !!ids.movie(tmdbId) : ids.show(tmdbId).length > 0;
  }


  /** Cards for TMDB list items, with what the library has of each. */
  private async cards(items: TmdbListItem[], type: TitleType): Promise<TitleCard[]> {
    const refs = items.map((i) => tmdbRef(type, i.id));
    const avail = await this.library.availability(refs);
    return items.map((i, n) => ({
      type,
      ref: formatRef(refs[n]!),
      tmdbId: i.id,
      title: i.title ?? i.name ?? "",
      year: yearOf(i.release_date ?? i.first_air_date),
      overview: i.overview,
      posterUrl: imageUrl(i.poster_path, "w342"),
      backdropUrl: imageUrl(i.backdrop_path, "w780"),
      rating: i.vote_average,
      available: avail.get(formatRef(refs[n]!)) ?? [],
    }));
  }

  private async movieCard(m: TmdbMovie): Promise<TitleCard> {
    return (await this.cards([{ ...m, media_type: "movie" }], "movie"))[0]!;
  }

  private async showCard(s: TmdbShow): Promise<TitleCard> {
    return (await this.cards([{ ...s, media_type: "tv" }], "show"))[0]!;
  }
}

function castOf(credits?: TmdbCredits) {
  return (credits?.cast ?? []).slice(0, 20).map((c) => ({ id: c.id, name: c.name, character: c.character ?? null, profileUrl: imageUrl(c.profile_path, "w185") }));
}

/** AniList relations shown as "Other seasons" on a title page, in order, with their labels. */
const RELATION_LABELS: Record<string, string> = { SEQUEL: "Sequel", PREQUEL: "Prequel", SIDE_STORY: "Side Story", SPIN_OFF: "Spin-off", ALTERNATIVE: "Alternative" };
const RELATION_ORDER = Object.keys(RELATION_LABELS);

/** AniList's statuses in TMDB's words. */
const SHOW_STATUS: Record<string, string> = {
  RELEASING: "Returning Series",
  FINISHED: "Ended",
  NOT_YET_RELEASED: "Planned",
  CANCELLED: "Canceled",
  HIATUS: "On Hiatus",
};

function showStatus(status: string | null | undefined): string | null {
  return status ? (SHOW_STATUS[status] ?? null) : null;
}

/** An AniList date as "YYYY-MM-DD", or null unless it's a whole date. */
function isoDate(d: AnilistDate | null | undefined): string | null {
  if (!d?.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The most episodes listed for an AniList show (One Piece has about 1,150); AniList's counts are data, not trusted. */
const MAX_ANILIST_EPISODES = 2_000;

/** How many of an AniList show's episodes are out: all of a finished one, else up to the next to air (at most MAX_ANILIST_EPISODES). */
function airedEpisodes(media: AnilistTitle): number {
  if (media.status === "NOT_YET_RELEASED") return 0;
  const aired = media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0);
  return Math.max(0, Math.min(MAX_ANILIST_EPISODES, aired));
}

/** `showUpNext` for an AniList show: its one season, numbered as AniList numbers it. */
function anilistUpNext(files: { season: number | null; episode: number | null }[], watched: ProgressRow[], aired: number, episodeCount: number) {
  const owned = files.filter((f) => f.season === 1 && f.episode !== null);
  const at = (episode: number, positionMs = 0) => ({ season: 1, episode, positionMs, available: owned.some((f) => f.episode === episode) });
  const mine = watched.filter((w) => w.season === 1);
  const inProgress = mine.filter(isResumable).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (inProgress) return at(inProgress.episode!, inProgress.positionMs);
  const furthest = mine.filter((w) => w.completed).sort((a, b) => b.episode! - a.episode!)[0];
  if (furthest && furthest.episode! < aired) return at(furthest.episode! + 1);
  // Nothing watched yet (or all of it): the first episode the library has, else the first.
  const firstOwned = owned.sort((a, b) => a.episode! - b.episode!)[0];
  if (firstOwned) return at(firstOwned.episode!);
  return episodeCount > 0 ? at(1) : null;
}

const VIDEO_ORDER = ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes"];

/** YouTube trailers and extras for a "Trailers & Extras" rail: trailers first, official first. */
function videosOf(videos?: TmdbMovie["videos"]) {
  return (videos?.results ?? [])
    .filter((v) => v.site === "YouTube" && VIDEO_ORDER.includes(v.type))
    .sort((a, b) => VIDEO_ORDER.indexOf(a.type) - VIDEO_ORDER.indexOf(b.type) || Number(!!b.official) - Number(!!a.official))
    .slice(0, 12)
    .map((v) => youtubeVideo(v.key, v.name, v.type));
}

function youtubeVideo(key: string, name: string, type: string) {
  return {
    key,
    name,
    type,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(key)}/hqdefault.jpg`,
  };
}

function trailerOf(videos?: TmdbMovie["videos"]) {
  const t = videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ?? videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer");
  return t ? { site: "youtube", key: t.key, name: t.name } : null;
}

/** `extra` mixed into `main`, one after every `every` cards of `main`. */
function interleave<T>(main: T[], extra: T[], every: number): T[] {
  const out: T[] = [];
  let e = 0;
  main.forEach((item, i) => {
    out.push(item);
    if ((i + 1) % every === 0 && e < extra.length) out.push(extra[e++]!);
  });
  return out.concat(extra.slice(e));
}
