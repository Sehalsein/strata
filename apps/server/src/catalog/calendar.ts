import type { Library } from "../library";
import type { ProgressStore } from "../progress";
import type { Anilist } from "./anime/anilist";
import type { AnimeEntry, AnimeIds } from "./anime/ids";
import { resolveEpisode } from "./anime/match";
import { imageUrl, type Tmdb, type TmdbSeason, type TmdbShow } from "./tmdb";

const DAY_S = 86_400;
/** How far back and ahead the calendar reaches. */
export const CALENDAR_PAST_DAYS = 7;
export const CALENDAR_FUTURE_DAYS = 30;

/** An episode of a show on a profile's list, aired recently or coming up. */
export interface CalendarEpisode {
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** TMDB numbering; null for an anime episode TMDB doesn't have yet. */
  season: number | null;
  episode: number;
  name: string | null;
  /** The broadcast time, when known (anime, from AniList), as an ISO instant. */
  airsAt: string | null;
  /** The air date (YYYY-MM-DD): TMDB's, or the UTC date of `airsAt`. */
  airDate: string;
  /** In the server's library. */
  available: boolean;
}

const isoDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The calendar: episodes of the shows on a profile's list from the last week and the
 * next month. Anime come from AniList's schedule (exact times), everything else from
 * TMDB's air dates.
 */
export class CalendarService {
  constructor(
    private readonly tmdb: Tmdb,
    private readonly library: Library,
    private readonly progress: ProgressStore,
    private readonly anime?: { ids: AnimeIds; anilist: Anilist },
    /** The profile's content limit: shows above it stay off its calendar. */
    private readonly allowed: (profileId: number, tmdbId: number) => Promise<boolean> = async () => true,
  ) {}

  async episodes(profileId: number, now = Date.now()): Promise<CalendarEpisode[]> {
    // Whole days, so the window (and AniList's cache key) holds for a day.
    const today = Math.floor(now / 1000 / DAY_S) * DAY_S;
    const from = today - CALENDAR_PAST_DAYS * DAY_S;
    const to = today + (CALENDAR_FUTURE_DAYS + 1) * DAY_S;
    const listed = this.progress.watchlist(profileId).filter((r) => r.type === "show").map((r) => r.tmdbId);
    const showIds = (await Promise.all(listed.map(async (id) => ((await this.allowed(profileId, id).catch(() => false)) ? id : null)))).filter((id): id is number => id !== null);
    await this.anime?.ids.ready().catch(() => {});

    const shows = (await Promise.all(showIds.map((id) => this.tmdb.show(id).catch(() => null)))).filter((s): s is TmdbShow => !!s);
    const animeEntries = new Map(shows.map((s) => [s.id, (this.anime?.ids.show(s.id) ?? []).filter((e) => e.anilistId)]));
    const anime = shows.filter((s) => animeEntries.get(s.id)!.length > 0);
    const other = shows.filter((s) => animeEntries.get(s.id)!.length === 0);

    const [fromAnilist, fromTmdb] = await Promise.all([
      this.animeEpisodes(anime, animeEntries, from, to).catch(() => [] as CalendarEpisode[]),
      Promise.all(other.map((s) => this.tmdbEpisodes(s, isoDate(from), isoDate(to)).catch(() => [] as CalendarEpisode[]))).then((l) => l.flat()),
    ]);
    const key = (e: CalendarEpisode) => e.airsAt ?? `${e.airDate}T23:59:59Z`;
    return [...fromAnilist, ...fromTmdb].sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
  }

  private async animeEpisodes(shows: TmdbShow[], entries: Map<number, AnimeEntry[]>, from: number, to: number): Promise<CalendarEpisode[]> {
    const byAnilist = new Map<number, { show: TmdbShow; entry: AnimeEntry }>();
    for (const show of shows) for (const entry of entries.get(show.id)!) byAnilist.set(entry.anilistId!, { show, entry });
    if (!byAnilist.size) return [];
    const airing = (await this.anime!.anilist.airing([...byAnilist.keys()], from, to)) ?? [];
    const seasons = new Map<string, Promise<TmdbSeason | null>>();
    return Promise.all(
      airing.flatMap((a) => {
        const match = byAnilist.get(a.mediaId);
        if (!match) return [];
        const { show, entry } = match;
        const tmdbSeasons = show.seasons.filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
        const at = resolveEpisode(entries.get(show.id)!, entry, undefined, a.episode, tmdbSeasons);
        const key = `${show.id}:${at.season}`;
        if (!seasons.has(key)) seasons.set(key, this.tmdb.season(show.id, at.season).catch(() => null));
        return [
          seasons.get(key)!.then((season) => {
            const known = season?.episodes.find((e) => e.episode_number === at.episode);
            return this.entry(show, known ? at.season : null, at.episode, known?.name ?? null, new Date(a.airingAt * 1000).toISOString(), isoDate(a.airingAt));
          }),
        ];
      }),
    );
  }

  private async tmdbEpisodes(show: TmdbShow, from: string, to: string): Promise<CalendarEpisode[]> {
    // The latest season, and the next episode's when it's a new one.
    const latest = Math.max(0, ...show.seasons.map((s) => s.season_number));
    const numbers = new Set([latest, show.next_episode_to_air?.season_number].filter((n): n is number => !!n));
    const seasons = await Promise.all([...numbers].map((n) => this.tmdb.season(show.id, n).catch(() => null)));
    return seasons
      .flatMap((s) => s?.episodes ?? [])
      .filter((e) => e.air_date && e.air_date >= from && e.air_date < to)
      .map((e) => this.entry(show, e.season_number, e.episode_number, e.name || null, null, e.air_date!));
  }

  private entry(show: TmdbShow, season: number | null, episode: number, name: string | null, airsAt: string | null, airDate: string): CalendarEpisode {
    return {
      tmdbId: show.id,
      title: show.name,
      posterUrl: imageUrl(show.poster_path, "w342"),
      backdropUrl: imageUrl(show.backdrop_path, "w780"),
      season,
      episode,
      name,
      airsAt,
      airDate,
      available: season !== null && this.library.filesFor("episode", show.id, season, episode).length > 0,
    };
  }
}
