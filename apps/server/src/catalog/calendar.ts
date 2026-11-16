import type { Library } from "../library";
import type { ProgressStore } from "../progress";
import type { Anilist } from "./anime/anilist";
import type { AnimeEntry, AnimeIds } from "./anime/ids";
import { resolveEpisode } from "./anime/match";
import { formatRef, parseRef, tmdbRef, type TitleRef } from "./ref";
import { imageUrl, type Tmdb, type TmdbSeason, type TmdbShow } from "./tmdb";
import { anilistUpcoming, filmReleases, RELEASE_TYPES, REMINDER_DAYS, showUpcoming, type Upcoming } from "./upcoming";

const DAY_S = 86_400;
/** How far back and ahead the calendar reaches. */
export const CALENDAR_PAST_DAYS = 7;
export const CALENDAR_FUTURE_DAYS = 30;

/** An episode of a show on a profile's list, aired recently or coming up. */
export interface CalendarEpisode {
  /** The show (`formatRef`). */
  ref: string;
  /** TMDB's id: TMDB shows, and AniList shows the anime id list maps to TMDB. */
  tmdbId?: number;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /**
   * The show's numbering: TMDB's (null for an anime episode TMDB doesn't have yet), or 1
   * for an AniList show (its episodes are AniList's).
   */
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

/** Shows someone is watching (any episode played this recently) are followed without being on My List. */
const FOLLOW_WATCHING_DAYS = 90;
/** Recently out titles that are checked for being ready to play (each check may search for releases). */
const READY_CHECKS = 8;
const READY_RECENT_DAYS = 14;

/**
 * Something on a person's calendar, ready for the apps to show and notify as it is: an
 * episode of a show they follow (on My List, or one they're watching) or a release of a
 * film on My List (in cinemas, to stream or rent, on disc). The server words it all.
 */
export interface CalendarEntry {
  /** Stable, for notifications: the same entry keeps its id. */
  id: string;
  kind: "episode" | "movie";
  /** The show or film (`formatRef`). */
  ref: string;
  tmdbId?: number;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** What it is, in words: "S2 E5 · The One Where…", "Out to stream or rent", "In cinemas". */
  label: string;
  /** The day (YYYY-MM-DD) and, when known, the exact time (ISO). */
  date: string;
  airsAt: string | null;
  /** It's out, and Strata can play it now (in the library, or ready on TorBox). */
  ready: boolean;
  /** What Play starts: the episode (show entries), or the film. */
  play: { season: number; episode: number } | null;
  /**
   * The notification for it: at `airsAt` when there's a time, else on the morning of `date`
   * (the device's own morning). A ready-to-play note has `now`: show it once, straight away.
   */
  alert: { title: string; body: string; now?: boolean } | null;
}

/** TMDB's release types worth a calendar entry, and how they read. */

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
    private readonly allowed: (userId: string, show: TitleRef) => Promise<boolean> = async () => true,
    /** The household's region, for film release dates. */
    private readonly region: () => string = () => "US",
    /** Whether a released title can play now beyond the library (a ready release on TorBox). */
    private readonly readyElsewhere: (target: { ref: TitleRef; season?: number; episode?: number }) => Promise<boolean> = async () => false,
  ) {}

  /**
   * A person's calendar as entries the apps show as they are: episodes of the shows they
   * follow, releases of the films on their list, with words, ready-to-play state and the
   * notification for each.
   */
  async entries(userId: string, now = Date.now()): Promise<{ entries: CalendarEntry[]; episodes: CalendarEpisode[] }> {
    const [episodes, movies, reminded] = await Promise.all([
      this.episodes(userId, now),
      this.movieReleases(userId, now).catch(() => [] as CalendarEntry[]),
      this.remindedBeyond(userId, now).catch(() => [] as CalendarEntry[]),
    ]);
    const today = new Date(now).toISOString().slice(0, 10);
    const fromEpisodes = episodes.map((e): CalendarEntry => {
      const code = e.season !== null ? `S${e.season} E${e.episode}` : `Episode ${e.episode}`;
      const out = e.airsAt ? "is out now" : "airs today";
      return {
        id: `${e.ref}:e:${e.season ?? "x"}:${e.episode}:${e.airDate}`,
        kind: "episode",
        ref: e.ref,
        ...(e.tmdbId ? { tmdbId: e.tmdbId } : {}),
        title: e.title,
        posterUrl: e.posterUrl,
        backdropUrl: e.backdropUrl,
        label: [code, e.name].filter(Boolean).join(" · "),
        date: e.airDate,
        airsAt: e.airsAt,
        ready: e.available,
        play: e.season !== null ? { season: e.season, episode: e.episode } : null,
        alert: { title: e.title, body: `${[code, e.name].filter(Boolean).join(" · ")} ${out}.` },
      };
    });
    const all = [...fromEpisodes, ...movies, ...reminded];
    await this.markReady(all, today, now);
    const key = (e: CalendarEntry) => e.airsAt ?? `${e.date}T23:59:59Z`;
    return { entries: all.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title)), episodes };
  }

  /**
   * Ready to play: what's out and playable now. The library answers for everything; for the
   * few most recently out that aren't in it, a ready release on TorBox counts too. Those
   * get a "ready to play" note instead of the release one.
   */
  private async markReady(entries: CalendarEntry[], today: string, now: number) {
    const out = entries.filter((e) => e.date <= today);
    const recent = new Date(now - READY_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const candidates = out
      .filter((e) => !e.ready && e.date >= recent)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, READY_CHECKS);
    await Promise.all(
      candidates.map(async (e) => {
        const ref = parseRef(e.ref);
        if (!ref) return;
        e.ready = await this.readyElsewhere({ ref, season: e.play?.season, episode: e.play?.episode }).catch(() => false);
      }),
    );
    for (const e of out) {
      if (!e.ready || e.date < recent) continue;
      const what = e.kind === "episode" ? `${e.label} of ${e.title}` : e.title;
      e.alert = { title: e.title, body: `${what} is ready to play in Strata.`, now: true };
    }
  }

  /**
   * Releases of the films on a person's list, in the household's region (else the US), in
   * the calendar's window; and of films they asked to be reminded of, up to a year ahead.
   */
  private async movieReleases(userId: string, now: number): Promise<CalendarEntry[]> {
    const today = Math.floor(now / 1000 / DAY_S) * DAY_S;
    const from = isoDate(today - CALENDAR_PAST_DAYS * DAY_S);
    const to = isoDate(today + (CALENDAR_FUTURE_DAYS + 1) * DAY_S);
    const remindTo = isoDate(today + REMINDER_DAYS * DAY_S);
    const [onList, reminders] = await Promise.all([this.progress.watchlist(userId), this.progress.reminders(userId)]);
    const reminded = new Set(reminders.filter((r) => r.type === "movie" && r.source === "tmdb").map((r) => r.titleId));
    const listed = [...new Set([...onList.filter((r) => r.type === "movie" && r.source === "tmdb").map((r) => r.titleId), ...reminded])];
    const region = this.region().toUpperCase();
    const out = await Promise.all(
      listed.map(async (titleId) => {
        const ref = tmdbRef("movie", titleId);
        if (!(await this.allowed(userId, ref).catch(() => false))) return [];
        const m = await this.tmdb.movie(titleId).catch(() => null);
        if (!m) return [];
        const until = reminded.has(titleId) ? remindTo : to;
        return filmReleases(m, region)
          .filter(({ day }) => day >= from && day < until)
          .map(({ type, day }): CalendarEntry => ({
            id: `${formatRef(ref)}:r:${type}:${day}`,
            kind: "movie",
            ref: formatRef(ref),
            tmdbId: m.id,
            title: m.title,
            posterUrl: imageUrl(m.poster_path, "w342"),
            backdropUrl: imageUrl(m.backdrop_path, "w780"),
            label: RELEASE_TYPES[type]!.label,
            date: day,
            airsAt: null,
            ready: false,
            play: null,
            alert: { title: m.title, body: `${m.title} ${RELEASE_TYPES[type]!.out}.` },
          }));
      }),
    );
    const flat = out.flat();
    const avail = await this.library.availability(flat.map((e) => parseRef(e.ref)!));
    for (const e of flat) e.ready = (avail.get(e.ref)?.length ?? 0) > 0;
    return flat;
  }

  /**
   * Titles someone asked to be reminded of that come out after the calendar's month (within
   * the month, a reminded show is followed like any other): a show's next episode or
   * premiere, an AniList film's release. One entry each, up to a year ahead.
   */
  private async remindedBeyond(userId: string, now: number): Promise<CalendarEntry[]> {
    const today = Math.floor(now / 1000 / DAY_S) * DAY_S;
    const from = isoDate(today - CALENDAR_PAST_DAYS * DAY_S);
    const monthEnd = isoDate(today + (CALENDAR_FUTURE_DAYS + 1) * DAY_S);
    const until = isoDate(today + REMINDER_DAYS * DAY_S);
    const reminders = (await this.progress.reminders(userId)).filter((r) => !(r.source === "tmdb" && r.type === "movie"));
    const out = await Promise.all(
      reminders.map(async (r): Promise<CalendarEntry | null> => {
        const ref: TitleRef = { source: r.source, type: r.type, id: r.titleId };
        if (!(await this.allowed(userId, ref).catch(() => false))) return null;
        let found: { title: string; poster: string | null; backdrop: string | null; tmdbId?: number; next: Upcoming | null } | null = null;
        if (r.source === "tmdb") {
          const s = await this.tmdb.show(r.titleId).catch(() => null);
          if (s) found = { title: s.name, poster: imageUrl(s.poster_path, "w342"), backdrop: imageUrl(s.backdrop_path, "w780"), tmdbId: s.id, next: showUpcoming(s, isoDate(today - DAY_S)) };
        } else if (this.anime) {
          const m = await this.anime.anilist.title(r.titleId).catch(() => null);
          if (m && !m.isAdult) {
            const tmdbId = this.anime.ids.anilist(r.titleId)?.tmdbTv;
            found = { title: m.title.english || m.title.romaji || "", poster: m.coverImage?.large ?? null, backdrop: m.bannerImage ?? null, ...(tmdbId ? { tmdbId } : {}), next: anilistUpcoming(m, r.type, today * 1000) };
          }
        }
        const next = found?.next;
        if (!found?.title || !next || next.date >= until) return null;
        // A followed show's episodes this month are already on the calendar; an AniList film isn't.
        if (r.type === "show" ? next.date < monthEnd : next.date < from) return null;
        return {
          id: `${formatRef(ref)}:soon:${next.date}`,
          kind: r.type === "movie" ? "movie" : "episode",
          ref: formatRef(ref),
          ...(found.tmdbId ? { tmdbId: found.tmdbId } : {}),
          title: found.title,
          posterUrl: found.poster,
          backdropUrl: found.backdrop,
          label: next.label,
          date: next.date,
          airsAt: next.airsAt,
          ready: false,
          play: null,
          alert: { title: found.title, body: `${found.title} ${next.out}.` },
        };
      }),
    );
    return out.filter((e): e is CalendarEntry => e !== null);
  }

  async episodes(userId: string, now = Date.now()): Promise<CalendarEpisode[]> {
    // Whole days, so the window (and AniList's cache key) holds for a day.
    const today = Math.floor(now / 1000 / DAY_S) * DAY_S;
    const from = today - CALENDAR_PAST_DAYS * DAY_S;
    const to = today + (CALENDAR_FUTURE_DAYS + 1) * DAY_S;
    // TMDB shows' episodes come from TMDB (and AniList, through the anime id list);
    // AniList shows' from AniList's schedule.
    // Followed: shows on My List, and shows they've been watching lately.
    const watching = (await this.progress.history(userId))
      .filter((r) => r.mediaType === "episode" && r.updatedAt >= now - FOLLOW_WATCHING_DAYS * 86_400_000)
      .map((r): TitleRef => ({ source: r.source, type: "show", id: r.titleId }));
    const [list, reminders] = await Promise.all([this.progress.watchlist(userId), this.progress.reminders(userId)]);
    const onList = [...list, ...reminders].filter((r) => r.type === "show").map((r): TitleRef => ({ source: r.source, type: "show", id: r.titleId }));
    const listed = [...new Map([...onList, ...watching].map((r) => [formatRef(r), r])).values()];
    const shown = (await Promise.all(listed.map(async (ref) => ((await this.allowed(userId, ref).catch(() => false)) ? ref : null)))).filter((ref): ref is TitleRef => ref !== null);
    const showIds = shown.filter((r) => r.source === "tmdb").map((r) => r.id);
    const anilistIds = shown.filter((r) => r.source === "anilist").map((r) => r.id);
    await this.anime?.ids.ready().catch(() => {});

    const shows = (await Promise.all(showIds.map((id) => this.tmdb.show(id).catch(() => null)))).filter((s): s is TmdbShow => !!s);
    const animeEntries = new Map(shows.map((s) => [s.id, (this.anime?.ids.show(s.id) ?? []).filter((e) => e.anilistId)]));
    const anime = shows.filter((s) => animeEntries.get(s.id)!.length > 0);
    const other = shows.filter((s) => animeEntries.get(s.id)!.length === 0);

    const [fromAnilist, fromTmdb, anilistShows] = await Promise.all([
      this.animeEpisodes(anime, animeEntries, from, to).catch(() => [] as CalendarEpisode[]),
      Promise.all(other.map((s) => this.tmdbEpisodes(s, isoDate(from), isoDate(to)).catch(() => [] as CalendarEpisode[]))).then((l) => l.flat()),
      this.anilistShowEpisodes(anilistIds, from, to).catch(() => [] as CalendarEpisode[]),
    ]);
    const key = (e: CalendarEpisode) => e.airsAt ?? `${e.airDate}T23:59:59Z`;
    const all = [...fromAnilist, ...fromTmdb, ...anilistShows];
    await Promise.all(
      all.map(async (e) => {
        const show = parseRef(e.ref);
        e.available = !!show && e.season !== null && (await this.library.filesFor(show, e.season, e.episode)).length > 0;
      }),
    );
    return all.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
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

  /** Episodes of AniList shows on the list, from AniList's schedule: numbered as AniList numbers them. */
  private async anilistShowEpisodes(anilistIds: number[], from: number, to: number): Promise<CalendarEpisode[]> {
    if (!anilistIds.length || !this.anime) return [];
    const { anilist, ids } = this.anime;
    const airing = await anilist.airing(anilistIds, from, to);
    const media = new Map((await Promise.all([...new Set(airing.map((a) => a.mediaId))].map((id) => anilist.title(id).catch(() => null)))).filter((m) => !!m).map((m) => [m!.id, m!]));
    return airing.flatMap((a) => {
      const m = media.get(a.mediaId);
      if (!m || m.isAdult) return [];
      const tmdbId = ids.anilist(a.mediaId)?.tmdbTv;
      return [
        {
          ref: formatRef({ source: "anilist", type: "show", id: a.mediaId }),
          ...(tmdbId ? { tmdbId } : {}),
          title: m.title.english?.trim() || m.title.romaji?.trim() || "",
          posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
          backdropUrl: m.bannerImage ?? null,
          season: 1,
          episode: a.episode,
          name: null,
          airsAt: new Date(a.airingAt * 1000).toISOString(),
          airDate: isoDate(a.airingAt),
          available: false, // filled in by episodes()
        },
      ];
    });
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
      ref: formatRef(tmdbRef("show", show.id)),
      tmdbId: show.id,
      title: show.name,
      posterUrl: imageUrl(show.poster_path, "w342"),
      backdropUrl: imageUrl(show.backdrop_path, "w780"),
      season,
      episode,
      name,
      airsAt,
      airDate,
      available: false, // filled in by episodes()
    };
  }
}
