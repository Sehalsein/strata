import type { ParsedName } from "../../media/parse";
import { diceCoefficient, normalize, type MatchResult } from "../matcher";
import { type Tmdb, yearOf } from "../tmdb";
import type { Anilist, AnilistMedia } from "./anilist";
import type { AnimeEntry, AnimeIds } from "./ids";

/**
 * Matches anime-style file names ("[Group] Sousou no Frieren - 12") to TMDB: AniList
 * finds the anime from its (usually romaji) title, the id list maps it to the TMDB show
 * or movie, and the episode is translated to TMDB's season/episode numbering.
 */
export class AnimeMatcher {
  constructor(
    private readonly anilist: Anilist,
    private readonly ids: AnimeIds,
    private readonly tmdb: Tmdb,
  ) {}

  async match(parsed: ParsedName): Promise<MatchResult | null> {
    await this.ids.ready();
    const media = pickAnime(await this.anilist.search(parsed.title), parsed);
    const entry = media ? this.ids.anilist(media.id) : undefined;
    if (!media || !entry) return null;

    if (parsed.episode === undefined) {
      if (!entry.tmdbMovie) return null;
      const m = await this.tmdb.movie(entry.tmdbMovie);
      return { type: "movie", tmdbId: m.id, title: m.title, year: yearOf(m.release_date), posterPath: m.poster_path ?? null, backdropPath: m.backdrop_path ?? null, genreIds: m.genres.map((g) => g.id) };
    }

    if (!entry.tmdbTv) return null;
    const show = await this.tmdb.show(entry.tmdbTv);
    const seasons = show.seasons.filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const at = resolveEpisode(this.ids.show(entry.tmdbTv), entry, parsed.season, parsed.episode, seasons);
    return {
      type: "show",
      tmdbId: show.id,
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
