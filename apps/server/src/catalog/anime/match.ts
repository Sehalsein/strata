import type { ParsedName } from "../../media/parse";
import { diceCoefficient, normalize, type MatchResult } from "../matcher";
import { type Tmdb, yearOf } from "../tmdb";
import { AnilistUnavailableError, type Anilist, type AnilistMedia } from "./anilist";
import { anilistEpisode, type AnimeEntry, type AnimeIds } from "./ids";
import type { Kitsu } from "./kitsu";

/**
 * Matches anime-style file names ("[Group] Sousou no Frieren - 12") to AniList titles:
 * AniList finds the anime from its (usually romaji) title, and where the id list maps it
 * to TMDB, the episode is placed through TMDB's numbering on the AniList entry (season
 * or cour) it belongs to, numbered as that entry numbers it. AniList shows have one
 * season (1).
 */
export class AnimeMatcher {
  constructor(
    private readonly anilist: Anilist,
    private readonly ids: AnimeIds,
    private readonly tmdb: Tmdb,
    private readonly kitsu?: Kitsu,
  ) {}

  async match(parsed: ParsedName): Promise<MatchResult | null> {
    await this.ids.ready();
    let anilistDown: unknown = null;
    const found = await this.anilist.search(parsed.title).catch((err) => ((anilistDown = err), [] as AnilistMedia[]));
    const media = pickAnime(found, parsed);
    let anilistId = media?.id;
    let entry = media ? this.ids.anilist(media.id) : undefined;
    // AniList down or without a result: Kitsu's search, through its ids.
    if (!media && this.kitsu) {
      const kitsuMedia = pickAnime(await this.kitsu.search(parsed.title).catch(() => []), parsed);
      entry = kitsuMedia ? this.ids.kitsu(kitsuMedia.id) : undefined;
      anilistId = entry?.anilistId;
    }
    if (!anilistId) {
      if (anilistDown) throw anilistDown;
      // Only Kitsu knows it, and the id list has no AniList id for it: TMDB's, as before.
      return entry ? this.matchTmdb(parsed, entry) : null;
    }

    if (parsed.episode === undefined) return anilistMatch(this.anilist, "movie", anilistId);

    let at = { anilistId, episode: parsed.episode };
    if (entry?.tmdbTv) {
      const seasons = await this.tmdbSeasons(entry.tmdbTv);
      const entries = this.ids.show(entry.tmdbTv);
      const tmdbAt = resolveEpisode(entries, entry, parsed.season, parsed.episode, seasons);
      at = anilistEpisode(entries, tmdbAt.season, tmdbAt.episode, seasons) ?? at;
    }
    const show = await anilistMatch(this.anilist, "show", at.anilistId);
    return show && { ...show, season: 1, episode: at.episode };
  }

  /** A TMDB show's seasons (episode counts), or none when TMDB can't say. */
  private async tmdbSeasons(tmdbTv: number) {
    const show = await this.tmdb.show(tmdbTv).catch(() => null);
    return (show?.seasons ?? []).filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
  }

  /** The TMDB title an id-list entry maps to, in TMDB's numbering. */
  private async matchTmdb(parsed: ParsedName, entry: AnimeEntry): Promise<MatchResult | null> {
    if (parsed.episode === undefined) {
      if (!entry.tmdbMovie) return null;
      const m = await this.tmdb.movie(entry.tmdbMovie);
      return { source: "tmdb", type: "movie", titleId: m.id, title: m.title, year: yearOf(m.release_date), posterPath: m.poster_path ?? null, backdropPath: m.backdrop_path ?? null, genreIds: m.genres.map((g) => g.id) };
    }
    if (!entry.tmdbTv) return null;
    const show = await this.tmdb.show(entry.tmdbTv);
    const seasons = show.seasons.filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const at = resolveEpisode(this.ids.show(entry.tmdbTv), entry, parsed.season, parsed.episode, seasons);
    return {
      source: "tmdb",
      type: "show",
      titleId: show.id,
      title: show.name,
      year: yearOf(show.first_air_date),
      posterPath: show.poster_path ?? null,
      backdropPath: show.backdrop_path ?? null,
      genreIds: show.genres.map((g) => g.id),
      season: at.season,
      episode: at.episode,
    };
  }
}

/**
 * An AniList title as a match: its English (else romaji) title, year, cover and banner
 * (full URLs). Null when it isn't a `type` (AniList's movies are format MOVIE); throws
 * when AniList can't answer, so the file is matched again later rather than without
 * its artwork.
 */
export async function anilistMatch(anilist: Anilist, type: "movie" | "show", id: number): Promise<MatchResult | null> {
  const media = await anilist.title(id);
  if (!media) throw new AnilistUnavailableError();
  if ((media.format === "MOVIE") !== (type === "movie")) return null;
  return {
    source: "anilist",
    type,
    titleId: id,
    title: media.title.english?.trim() || media.title.romaji?.trim() || `AniList ${id}`,
    year: media.seasonYear ?? media.startDate?.year ?? null,
    posterPath: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    backdropPath: media.bannerImage ?? null,
    genreIds: null,
  };
}

/** The AniList result whose romaji, English or alternative title best matches. */
export function pickAnime(results: AnilistMedia[], parsed: ParsedName): AnilistMedia | null {
  const wanted = normalize(parsed.title);
  const wantMovie = parsed.episode === undefined;
  let best: { media: AnilistMedia; score: number } | null = null;
  results.forEach((media, rank) => {
    const names = [media.title.romaji, media.title.english, ...(media.synonyms ?? [])].filter((n): n is string => !!n).map(normalize);
    const similarity = Math.max(0, ...names.map((n) => (n === wanted ? 1 : diceCoefficient(n, wanted))));
    if (similarity < 0.6) return;
    let score = similarity * 10 - rank * 0.3;
    if (wantMovie !== (media.format === "MOVIE")) score -= 2;
    if (parsed.year && media.seasonYear) score += media.seasonYear === parsed.year ? 2 : -1;
    if (!best || score > best.score) best = { media, score };
  });
  return (best as { media: AnilistMedia } | null)?.media ?? null;
}

/**
 * Translates a release's episode to TMDB's season/episode:
 * 1. "S2 - 03": the entry for that (TVDB) season gives the TMDB season and offset.
 * 2. "- 12": the matched entry's TMDB season and offset, if the episode fits in it.
 * 3. Otherwise the number is absolute ("One Piece - 1122"): walk TMDB's seasons.
 */
export function resolveEpisode(
  entries: AnimeEntry[],
  matched: AnimeEntry,
  season: number | undefined,
  episode: number,
  tmdbSeasons: { season: number; episodes: number }[],
): { season: number; episode: number } {
  const fits = (s: number, e: number) => {
    const known = tmdbSeasons.find((x) => x.season === s);
    return !known || known.episodes === 0 || e <= known.episodes;
  };

  if (season !== undefined) {
    const forSeason = entries.find((e) => e.tvdbSeason === season && e.tmdbSeason !== undefined);
    if (forSeason) return { season: forSeason.tmdbSeason!, episode: forSeason.tmdbOffset + episode };
    return { season, episode };
  }

  if (matched.tmdbSeason !== undefined && fits(matched.tmdbSeason, matched.tmdbOffset + episode)) {
    return { season: matched.tmdbSeason, episode: matched.tmdbOffset + episode };
  }

  let remaining = episode;
  for (const s of [...tmdbSeasons].sort((a, b) => a.season - b.season)) {
    if (s.episodes > 0 && remaining <= s.episodes) return { season: s.season, episode: remaining };
    remaining -= s.episodes;
  }
  return { season: matched.tmdbSeason ?? 1, episode };
}
