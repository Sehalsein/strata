import type { FileProvider } from "../db/schema";
import type { Library } from "../library";
import { isResumable, type ProgressRow, type ProgressStore } from "../progress";
import type { Settings } from "../settings";
import { findCandidates, type Candidate } from "../sources/resolver";
import { imageUrl, yearOf, type Tmdb, type TmdbCredits, type TmdbListItem, type TmdbMovie, type TmdbShow } from "./tmdb";
import { logger } from "../log";
import type { Anilist } from "./anime/anilist";
import type { AnimeIds } from "./anime/ids";
import { ANIME_CATEGORIES, type Kitsu, type KitsuRail } from "./anime/kitsu";

const log = logger("catalog");

/**
 * TMDB has no anime genre; "Anime" is animation originally in Japanese. Negative so it
 * can never collide with a TMDB genre id.
 */
export const ANIME_GENRE_ID = -1;
const ANIME_DISCOVER = { with_genres: "16", with_original_language: "ja" };

export type TitleType = "movie" | "show";

export interface TitleCard {
  type: TitleType;
  tmdbId: number;
  title: string;
  year: number | null;
  overview?: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating?: number;
  available: FileProvider[];
  /** Why a title is in the Home hero ("Recently Added", "Trending Anime"). */
  eyebrow?: string;
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
  items: (TitleCard | ContinueCard)[];
}

export interface ProgressDto {
  positionMs: number;
  durationMs: number;
  completed: boolean;
}

const progressDto = (row?: ProgressRow): ProgressDto | null => (row ? { positionMs: row.positionMs, durationMs: row.durationMs, completed: row.completed } : null);

export class CatalogService {
  constructor(
    private readonly tmdb: Tmdb,
    private readonly library: Library,
    private readonly progress: ProgressStore,
    private readonly settings: () => Settings,
    private readonly anime?: { ids: AnimeIds; anilist: Anilist; kitsu?: Kitsu },
  ) {}

  /**
   * AniList details for an anime title (romaji/Japanese titles, studio, score, next
   * airing), or null. Waits at most 1.5s: AniList is slow to call uncached, and the page
   * shouldn't wait on it; the answer is cached for next time.
   */
  private animeInfo(type: TitleType, tmdbId: number) {
    return Promise.race([this.animeInfoUncapped(type, tmdbId), Bun.sleep(1_500).then(() => null)]);
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

  async home(profileId: number): Promise<Shelf[]> {
    const shelves: Shelf[] = [];
    const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        log.warn(`Home shelf ${label} failed`, err);
        return null;
      }
    };

    const isAnime = (i: TmdbListItem) => i.original_language === "ja" && (i.genre_ids?.includes(16) ?? false);
    const [cont, nextUp, watchlist, trendingMovies, trendingShows, trendingAnime] = await Promise.all([
      safe("continue", () => this.continueWatching(profileId)),
      safe("nextUp", () => this.nextUp(profileId)),
      safe("watchlist", () => this.watchlist(profileId)),
      safe("trendingMovies", async () => this.cards((await this.tmdb.trending("movie")).results, "movie")),
      safe("trendingShows", async () => this.cards((await this.tmdb.trending("tv")).results.filter((i) => !isAnime(i)), "show")),
      safe("trendingAnime", () => this.trendingThisWeek("show", isAnime, ANIME_DISCOVER)),
    ]);
    const recentMovies = this.libraryCards("movie");
    const recentShows = this.libraryCards("show");

    const featured = await safe("featured", () =>
      this.featured([
        { label: "Recently Added", type: "movie", cards: recentMovies, take: 2 },
        { label: "Trending Movie", type: "movie", cards: trendingMovies ?? [], take: 3 },
        { label: "Trending Show", type: "show", cards: trendingShows ?? [], take: 2 },
        { label: "Trending Anime", type: "show", cards: trendingAnime ?? [], take: 2 },
        { label: "Recently Added", type: "show", cards: recentShows, take: 1 },
      ]),
    );
    if (featured?.length) shelves.push({ id: "featured", title: "Featured", kind: "titles", items: featured });
    if (cont?.length) shelves.push({ id: "continue", title: "Continue Watching", kind: "continue", items: cont });
    if (nextUp?.length) shelves.push({ id: "nextUp", title: "Next Up", kind: "continue", items: nextUp });
    if (watchlist?.length) shelves.push({ id: "watchlist", title: "My List", kind: "titles", items: watchlist });
    if (recentMovies.length) shelves.push({ id: "libraryMovies", title: "Recently Added Movies", kind: "titles", items: recentMovies });
    if (recentShows.length) shelves.push({ id: "libraryShows", title: "Recently Added Shows", kind: "titles", items: recentShows });
    if (trendingMovies?.length) shelves.push({ id: "trendingMovies", title: "Trending Movies", kind: "titles", items: trendingMovies });
    if (trendingShows?.length) shelves.push({ id: "trendingShows", title: "Trending Shows", kind: "titles", items: trendingShows });
    if (trendingAnime?.length) shelves.push({ id: "trendingAnime", title: "Trending Anime", kind: "titles", items: trendingAnime });
    return shelves;
  }

  /**
   * The Home hero carousel: a few titles from each source, taken in turns so the
   * carousel alternates between them. Each needs a backdrop; library titles are
   * filled out from TMDB (they're stored without an overview).
   */
  private async featured(sources: { label: string; type: TitleType; cards: TitleCard[]; take: number }[]): Promise<TitleCard[]> {
    const picks = await Promise.all(
      sources.map(async (src) => {
        const candidates = src.cards.filter((c) => c.backdropUrl).slice(0, src.take);
        const full = candidates.some((c) => !c.overview) ? await this.detailCards(src.type, candidates.map((c) => c.tmdbId)) : candidates;
        return full.filter((c) => c.backdropUrl).map((c) => ({ ...c, eyebrow: src.label }));
      }),
    );
    const seen = new Set<string>();
    const out: TitleCard[] = [];
    for (let round = 0; picks.some((p) => p.length > round); round++) {
      for (const list of picks) {
        const card = list[round];
        if (!card || seen.has(`${card.type}-${card.tmdbId}`)) continue;
        seen.add(`${card.type}-${card.tmdbId}`);
        out.push(card);
      }
    }
    return out.slice(0, 10);
  }

  async browse(type: TitleType, list: "trending" | "popular" | "topRated" | "library"): Promise<TitleCard[]> {
    if (list === "library") return this.libraryCards(type, 500);
    const tmdbType = type === "movie" ? "movie" : "tv";
    const page = list === "trending" ? await this.tmdb.trending(tmdbType) : list === "popular" ? await this.tmdb.popular(tmdbType) : await this.tmdb.topRated(tmdbType);
    return this.cards(page.results, type);
  }

  /** TMDB's genres for movies or shows, in the server's metadata language. */
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
    if (trending.length) shelves.push({ id: "trending", title: "Trending This Week", kind: "titles", items: trending });
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
    const items = pages.flat().filter(keep);
    if (items.length < 12) {
      const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      const window: Record<string, string> =
        type === "movie" ? { "primary_release_date.gte": day(60), "primary_release_date.lte": day(0) } : { "air_date.gte": day(7), "air_date.lte": day(0) };
      const recent = await this.tmdb.discover(tmdbType, { ...discoverFilter, ...window, sort_by: "popularity.desc" }).then((r) => r.results).catch(() => [] as TmdbListItem[]);
      const seen = new Set(items.map((i) => i.id));
      items.push(...recent.filter((i) => !seen.has(i.id)));
    }
    return this.cards(items.slice(0, 20), type);
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
    if (!ids || !kitsu) return [];
    await ids.ready();
    type Plan = { id: string; title: string; kind: "series" | "films"; rail: KitsuRail };
    const plans: Plan[] = category
      ? [
          { id: "anime-series-season", title: "This Season", kind: "series", rail: "season" },
          { id: "anime-series-popular", title: "Popular Series", kind: "series", rail: "popular" },
          { id: "anime-series-top", title: "Top Rated Series", kind: "series", rail: "top" },
          { id: "anime-films-popular", title: "Popular Movies", kind: "films", rail: "popular" },
          { id: "anime-films-top", title: "Top Rated Movies", kind: "films", rail: "top" },
        ]
      : [
          { id: "anime-series-season", title: "This Season", kind: "series", rail: "season" },
          { id: "anime-series-top", title: "Top Rated Series", kind: "series", rail: "top" },
          { id: "anime-films-recent", title: "New Movies", kind: "films", rail: "recent" },
          { id: "anime-series-lastSeason", title: "Last Season", kind: "series", rail: "lastSeason" },
          { id: "anime-series-popular", title: "All-Time Popular", kind: "series", rail: "popular" },
          { id: "anime-films-popular", title: "Popular Movies", kind: "films", rail: "popular" },
          { id: "anime-films-top", title: "Top Rated Movies", kind: "films", rail: "top" },
        ];
    const isAnime = (i: TmdbListItem) => i.original_language === "ja" && (i.genre_ids?.includes(16) ?? false);
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
    if (trending.length >= 3) shelves.unshift({ id: "anime-series-trending", title: "Trending This Week", kind: "titles", items: trending });
    return shelves;
  }

  /** Cards from TMDB details (cached), a few lookups at a time; ones that fail are left out. */
  private async detailCards(type: TitleType, tmdbIds: number[]): Promise<TitleCard[]> {
    const cards: (TitleCard | null)[] = new Array(tmdbIds.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < tmdbIds.length) {
        const i = next++;
        const id = tmdbIds[i]!;
        cards[i] = await (type === "movie" ? this.tmdb.movie(id).then((m) => this.movieCard(m)) : this.tmdb.show(id).then((s) => this.showCard(s))).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, tmdbIds.length) }, worker));
    return cards.filter((c): c is TitleCard => c !== null);
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
      movies: withRole(this.cards(ranked.filter((c) => c.media_type === "movie").slice(0, 40), "movie"), "movie"),
      shows: withRole(this.cards(ranked.filter((c) => c.media_type === "tv").slice(0, 40), "show"), "tv"),
    };
  }

  async search(query: string): Promise<TitleCard[]> {
    const page = await this.tmdb.searchMulti(query);
    const movies = page.results.filter((r) => r.media_type === "movie");
    const shows = page.results.filter((r) => r.media_type === "tv");
    const movieCards = this.cards(movies, "movie");
    const showCards = this.cards(shows, "show");
    // Keep TMDB's relevance order across both types.
    return page.results.flatMap((r) => (r.media_type === "movie" ? movieCards.filter((c) => c.tmdbId === r.id) : r.media_type === "tv" ? showCards.filter((c) => c.tmdbId === r.id) : []));
  }

  async movie(profileId: number, id: number) {
    const m = await this.tmdb.movie(id);
    const sources = findCandidates(this.library, this.settings(), "movie", id);
    const region = this.settings().region;
    const certification =
      m.release_dates?.results.find((r) => r.iso_3166_1 === region)?.release_dates.find((d) => d.certification)?.certification ?? null;
    return {
      type: "movie" as const,
      tmdbId: m.id,
      imdbId: m.imdb_id ?? m.external_ids?.imdb_id ?? null,
      title: m.title,
      tagline: m.tagline || null,
      overview: m.overview ?? "",
      year: yearOf(m.release_date),
      releaseDate: m.release_date || null,
      runtimeMinutes: m.runtime ?? null,
      genres: m.genres.map((g) => g.name),
      rating: m.vote_average ?? null,
      certification,
      posterUrl: imageUrl(m.poster_path, "w500"),
      backdropUrl: imageUrl(m.backdrop_path, "w1280"),
      cast: castOf(m.credits),
      directors: m.credits?.crew.filter((c) => c.job === "Director").map((c) => c.name) ?? [],
      trailer: trailerOf(m.videos),
      videos: videosOf(m.videos),
      collection: m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name } : null,
      recommendations: this.cards(m.recommendations?.results ?? [], "movie"),
      available: [...new Set(sources.map((s) => s.provider))],
      sources,
      progress: progressDto(this.progress.get(profileId, { mediaType: "movie", tmdbId: id })),
      inWatchlist: this.progress.inWatchlist(profileId, "movie", id),
      anime: await this.animeInfo("movie", id).catch(() => null),
    };
  }

  async show(profileId: number, id: number) {
    const s = await this.tmdb.show(id);
    const watched = this.progress.forShow(profileId, id);
    const available = this.library.filesFor("episode", id);
    const region = this.settings().region;
    return {
      type: "show" as const,
      tmdbId: s.id,
      imdbId: s.external_ids?.imdb_id ?? null,
      title: s.name,
      tagline: s.tagline || null,
      overview: s.overview ?? "",
      year: yearOf(s.first_air_date),
      firstAirDate: s.first_air_date || null,
      lastAirDate: s.last_air_date || null,
      status: s.status ?? null,
      genres: s.genres.map((g) => g.name),
      rating: s.vote_average ?? null,
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
      recommendations: this.cards(s.recommendations?.results ?? [], "show"),
      available: [...new Set(available.map((f) => f.provider))],
      /** Where the Play button should go: an in-progress episode, else the next unwatched one. */
      upNext: await this.showUpNext(s, watched),
      inWatchlist: this.progress.inWatchlist(profileId, "show", id),
      anime: await this.animeInfo("show", id).catch(() => null),
    };
  }

  async season(profileId: number, showId: number, seasonNumber: number) {
    const season = await this.tmdb.season(showId, seasonNumber);
    const files = this.library.filesFor("episode", showId, seasonNumber);
    const watched = new Map(this.progress.forShow(profileId, showId).filter((p) => p.season === seasonNumber).map((p) => [p.episode, p]));
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
        available: [...new Set(files.filter((f) => f.episode === e.episode_number).map((f) => f.provider))],
        progress: progressDto(watched.get(e.episode_number)),
      })),
    };
  }

  sources(type: "movie" | "episode", tmdbId: number, season?: number, episode?: number): Candidate[] {
    return findCandidates(this.library, this.settings(), type, tmdbId, season, episode);
  }

  private async continueWatching(profileId: number): Promise<ContinueCard[]> {
    const rows = this.progress.inProgress(profileId);
    const cards = await Promise.all(rows.map((row) => this.continueCard(row).catch(() => null)));
    return cards.filter((c): c is ContinueCard => c !== null);
  }

  private async continueCard(row: ProgressRow): Promise<ContinueCard> {
    if (row.mediaType === "movie") {
      const m = await this.tmdb.movie(row.tmdbId);
      return { ...this.movieCard(m), positionMs: row.positionMs, durationMs: row.durationMs };
    }
    const show = await this.tmdb.show(row.tmdbId);
    const season = await this.tmdb.season(row.tmdbId, row.season);
    const ep = season.episodes.find((e) => e.episode_number === row.episode);
    return {
      ...this.showCard(show),
      episode: { season: row.season, episode: row.episode, name: ep?.name ?? `Episode ${row.episode}`, stillUrl: imageUrl(ep?.still_path, "w780") },
      positionMs: row.positionMs,
      durationMs: row.durationMs,
    };
  }

  private async nextUp(profileId: number): Promise<ContinueCard[]> {
    const inProgressShows = new Set(this.progress.inProgress(profileId, 100).filter((r) => r.mediaType === "episode").map((r) => r.tmdbId));
    const latest = this.progress.recentlyCompletedEpisodes(profileId).filter((r) => !inProgressShows.has(r.tmdbId));
    const cards = await Promise.all(
      latest.map(async (row) => {
        try {
          const show = await this.tmdb.show(row.tmdbId);
          const next = await this.episodeAfter(show, row.season, row.episode);
          if (!next) return null;
          const done = this.progress.get(profileId, { mediaType: "episode", tmdbId: row.tmdbId, season: next.season, episode: next.episode });
          if (done?.completed) return null;
          return { ...this.showCard(show), episode: next, positionMs: 0, durationMs: 0 } satisfies ContinueCard;
        } catch {
          return null;
        }
      }),
    );
    return cards.filter((c) => c !== null) as ContinueCard[];
  }

  /** The aired episode after S{season}E{episode}, crossing into the next season. */
  async nextEpisode(showId: number, season: number, episode: number): Promise<EpisodeRef | null> {
    return this.episodeAfter(await this.tmdb.show(showId), season, episode);
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

  private async showUpNext(show: TmdbShow, watched: ProgressRow[]) {
    const inProgress = watched.filter(isResumable).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (inProgress) return { season: inProgress.season, episode: inProgress.episode, positionMs: inProgress.positionMs };
    const furthest = watched.filter((w) => w.completed).sort((a, b) => b.season - a.season || b.episode - a.episode)[0];
    if (furthest) {
      const next = await this.episodeAfter(show, furthest.season, furthest.episode).catch(() => null);
      if (next) return { season: next.season, episode: next.episode, positionMs: 0 };
    }
    const first = show.seasons.filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number)[0];
    return first ? { season: first.season_number, episode: 1, positionMs: 0 } : null;
  }

  private async watchlist(profileId: number): Promise<TitleCard[]> {
    const rows = this.progress.watchlist(profileId);
    const cards = await Promise.all(
      rows.map(async (r) => {
        try {
          return r.type === "movie" ? this.movieCard(await this.tmdb.movie(r.tmdbId)) : this.showCard(await this.tmdb.show(r.tmdbId));
        } catch {
          return null;
        }
      }),
    );
    return cards.filter((c): c is TitleCard => c !== null);
  }

  private libraryCards(type: TitleType, limit = 20): TitleCard[] {
    const items = this.library.recentlyAdded(type, limit);
    const avail = this.library.availability(type, items.map((i) => i.tmdbId));
    return items.map((i) => ({
      type,
      tmdbId: i.tmdbId,
      title: i.title,
      year: i.year,
      posterUrl: imageUrl(i.posterPath, "w342"),
      backdropUrl: imageUrl(i.backdropPath, "w780"),
      available: avail.get(i.tmdbId) ?? [],
    }));
  }

  private cards(items: TmdbListItem[], type: TitleType): TitleCard[] {
    const avail = this.library.availability(type, items.map((i) => i.id));
    return items.map((i) => ({
      type,
      tmdbId: i.id,
      title: i.title ?? i.name ?? "",
      year: yearOf(i.release_date ?? i.first_air_date),
      overview: i.overview,
      posterUrl: imageUrl(i.poster_path, "w342"),
      backdropUrl: imageUrl(i.backdrop_path, "w780"),
      rating: i.vote_average,
      available: avail.get(i.id) ?? [],
    }));
  }

  private movieCard(m: TmdbMovie): TitleCard {
    return this.cards([{ ...m, media_type: "movie" }], "movie")[0]!;
  }

  private showCard(s: TmdbShow): TitleCard {
    return this.cards([{ ...s, media_type: "tv" }], "show")[0]!;
  }
}

function castOf(credits?: TmdbCredits) {
  return (credits?.cast ?? []).slice(0, 20).map((c) => ({ id: c.id, name: c.name, character: c.character ?? null, profileUrl: imageUrl(c.profile_path, "w185") }));
}

const VIDEO_ORDER = ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes"];

/** YouTube trailers and extras for a "Trailers & Extras" rail: trailers first, official first. */
function videosOf(videos?: TmdbMovie["videos"]) {
  return (videos?.results ?? [])
    .filter((v) => v.site === "YouTube" && VIDEO_ORDER.includes(v.type))
    .sort((a, b) => VIDEO_ORDER.indexOf(a.type) - VIDEO_ORDER.indexOf(b.type) || Number(!!b.official) - Number(!!a.official))
    .slice(0, 12)
    .map((v) => ({
      key: v.key,
      name: v.name,
      type: v.type,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(v.key)}/hqdefault.jpg`,
    }));
}

function trailerOf(videos?: TmdbMovie["videos"]) {
  const t = videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ?? videos?.results.find((v) => v.site === "YouTube" && v.type === "Trailer");
  return t ? { site: "youtube", key: t.key, name: t.name } : null;
}
