import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../log";

const log = logger("anime");

/** Fribb/anime-lists: AniList/Kitsu/MAL/AniDB ids mapped to TMDB, refreshed daily. */
export const ANIME_LIST_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const MAX_AGE_MS = 24 * 60 * 60_000;
const RETRY_MS = 15 * 60_000;

/** One anime entry (a season or cour on AniList/Kitsu) and where it sits on TMDB. */
export interface AnimeEntry {
  anilistId?: number;
  kitsuId?: number;
  malId?: number;
  anidbId?: number;
  type?: string;
  tmdbTv?: number;
  tmdbMovie?: number;
  /** TMDB season this entry's episodes live in; absent = numbered absolutely across seasons. */
  tmdbSeason?: number;
  /** TVDB season, which is what release names' "S2" usually means. */
  tvdbSeason?: number;
  /** Episodes of the TMDB season before this entry's first (e.g. Frieren S2 = TMDB S1 E29+). */
  tmdbOffset: number;
}

interface RawEntry {
  type?: string;
  anilist_id?: number;
  kitsu_id?: number;
  mal_id?: number;
  anidb_id?: number;
  themoviedb_id?: { tv?: number; movie?: number } | number;
  season?: { tvdb?: number; tmdb?: number };
  episode_offset?: { tmdb?: number; tvdb?: number };
}

export class AnimeIds {
  private byAnilist = new Map<number, AnimeEntry>();
  private byKitsu = new Map<number, AnimeEntry>();
  private byTv = new Map<number, AnimeEntry[]>();
  private byMovie = new Map<number, AnimeEntry>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly cacheDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get size() {
    return this.byAnilist.size + this.byKitsu.size;
  }

  /** Loads the cached list (downloading it when missing or older than a day). */
  ready(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt < MAX_AGE_MS) return Promise.resolve();
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  anilist(id: number) {
    return this.byAnilist.get(id);
  }

  kitsu(id: number) {
    return this.byKitsu.get(id);
  }

  /** Every entry for a TMDB show, in TMDB order (season, then offset). */
  show(tmdbId: number): AnimeEntry[] {
    return this.byTv.get(tmdbId) ?? [];
  }

  movie(tmdbId: number) {
    return this.byMovie.get(tmdbId);
  }

  /** Replaces the index (also used by tests). */
  index(raw: RawEntry[]) {
    this.byAnilist.clear();
    this.byKitsu.clear();
    this.byTv.clear();
    this.byMovie.clear();
    // Downloaded data: only whole numbers in range go into TMDB paths and episode math.
    const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 1e9 ? (v as number) : undefined);
    const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000 ? (v as number) : undefined);
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const tmdb = typeof r.themoviedb_id === "number" ? { tv: r.themoviedb_id } : r.themoviedb_id && typeof r.themoviedb_id === "object" ? r.themoviedb_id : {};
      const entry: AnimeEntry = {
        anilistId: id(r.anilist_id),
        kitsuId: id(r.kitsu_id),
        malId: id(r.mal_id),
        anidbId: id(r.anidb_id),
        type: typeof r.type === "string" ? r.type : undefined,
        tmdbTv: id(tmdb.tv),
        tmdbMovie: id(tmdb.movie),
        tmdbSeason: count(r.season?.tmdb),
        tvdbSeason: count(r.season?.tvdb),
        tmdbOffset: count(r.episode_offset?.tmdb) ?? 0,
      };
      if (entry.anilistId) this.byAnilist.set(entry.anilistId, entry);
      if (entry.kitsuId) this.byKitsu.set(entry.kitsuId, entry);
      if (entry.tmdbMovie) this.byMovie.set(entry.tmdbMovie, entry);
      if (entry.tmdbTv) {
        const list = this.byTv.get(entry.tmdbTv) ?? [];
        list.push(entry);
        this.byTv.set(entry.tmdbTv, list);
      }
    }
    for (const list of this.byTv.values()) list.sort((a, b) => (a.tmdbSeason ?? 0) - (b.tmdbSeason ?? 0) || a.tmdbOffset - b.tmdbOffset);
    this.loadedAt = Date.now();
  }

  private async load() {
    const file = join(this.cacheDir, "anime-list-full.json");
    const cached = Bun.file(file);
    const fresh = (await cached.exists()) && Date.now() - cached.lastModified < MAX_AGE_MS;
    if (!fresh) {
      try {
        await this.download(file);
      } catch (err) {
        // Keep working from an older copy when GitHub is unreachable; without one, try
        // again in 15 minutes rather than on every lookup.
        log.warn("Couldn't refresh the anime id list", err);
        if (!existsSync(file)) {
          this.loadedAt = Date.now() - MAX_AGE_MS + RETRY_MS;
          return;
        }
      }
    }
    try {
      this.index((await Bun.file(file).json()) as RawEntry[]);
      log.info(`Anime id list: ${this.byAnilist.size} AniList / ${this.byTv.size} TMDB shows`);
    } catch (err) {
      log.warn("Anime id list is unreadable", err);
    }
  }

  private async download(file: string) {
    mkdirSync(this.cacheDir, { recursive: true });
    const res = await this.fetchImpl(ANIME_LIST_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`anime-lists: HTTP ${res.status}`);
    const body = await res.text();
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1000) throw new Error("anime-lists: unexpected content");
    const tmp = `${file}.tmp`;
    await Bun.write(tmp, body);
    renameSync(tmp, file);
  }
}

/**
 * The Kitsu id and episode for a TMDB episode, as Torrentio's anime streams want them
 * ("kitsu:<id>:<episode>"; Kitsu has one entry per season or cour).
 */
export function kitsuEpisode(
  entries: AnimeEntry[],
  season: number,
  episode: number,
  tmdbSeasons: { season: number; episodes: number }[],
): { kitsuId: number; episode: number } | null {
  const inSeason = entries
    .filter((e) => e.kitsuId && e.tmdbSeason === season && e.tmdbOffset < episode)
    .sort((a, b) => b.tmdbOffset - a.tmdbOffset)[0];
  if (inSeason) return { kitsuId: inSeason.kitsuId!, episode: episode - inSeason.tmdbOffset };
  // One entry numbered absolutely across TMDB's seasons (One Piece).
  const absolute = entries.find((e) => e.kitsuId && e.tmdbSeason === undefined);
  if (!absolute) return null;
  const before = tmdbSeasons.filter((s) => s.season > 0 && s.season < season).reduce((sum, s) => sum + s.episodes, 0);
  return { kitsuId: absolute.kitsuId!, episode: before + episode };
}
