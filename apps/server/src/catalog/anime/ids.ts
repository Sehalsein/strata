import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { ApiCache } from "../apiCache";
import { join } from "node:path";
import { logger } from "../../log";
import { SharedWork } from "../../inFlight";
import { globalFetch } from "../../net";

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

export interface RawEntry {
  type?: string;
  anilist_id?: number;
  kitsu_id?: number;
  mal_id?: number;
  anidb_id?: number;
  /** Movies come as a list (a film split in parts maps to several); the first is the film. */
  themoviedb_id?: { tv?: number; movie?: number | number[] } | number;
  season?: { tvdb?: number; tmdb?: number };
  episode_offset?: { tmdb?: number; tvdb?: number };
}

export class AnimeIds {
  private byAnilist = new Map<number, AnimeEntry>();
  private byKitsu = new Map<number, AnimeEntry>();
  private byTv = new Map<number, AnimeEntry[]>();
  private byMovie = new Map<number, AnimeEntry>();
  private loadedAt = 0;
  private loading = new SharedWork<"list", void>();

  /**
   * `store` keeps the downloaded list: a file in the data folder (home server), or the
   * shared cache in the database (cloud server, which has no disk to keep it on).
   */
  constructor(
    private readonly store: AnimeIdStore,
    private readonly fetchImpl: typeof fetch = globalFetch,
    /**
     * Whether a lookup may download the list itself when the stored copy is old. Not on
     * Workers: the 10+ MB download is too much for a request, so only the daily job
     * (`refresh`) fetches it there, and lookups use whatever copy is stored.
     */
    private readonly downloadOnLookup = true,
  ) {}

  get size() {
    return this.byAnilist.size + this.byKitsu.size;
  }

  /** Loads the cached list (downloading it when missing or older than a day, where allowed). */
  ready(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt < MAX_AGE_MS) return Promise.resolve();
    return this.loading.get("list", () => this.load(this.downloadOnLookup));
  }

  /**
   * The daily job: downloads the list when the stored copy (not this instance's) is a day
   * old or missing, then loads it.
   */
  refresh(): Promise<void> {
    return this.loading.get("list", () => this.load(true));
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
      // A season/offset that's present but invalid would read as "absolute numbering":
      // skip the entry rather than misplace its episodes.
      if (r.season?.tmdb !== undefined && count(r.season.tmdb) === undefined) continue;
      if (r.season?.tvdb !== undefined && count(r.season.tvdb) === undefined) continue;
      if (r.episode_offset?.tmdb !== undefined && count(r.episode_offset.tmdb) === undefined) continue;
      const entry: AnimeEntry = {
        anilistId: id(r.anilist_id),
        kitsuId: id(r.kitsu_id),
        malId: id(r.mal_id),
        anidbId: id(r.anidb_id),
        type: typeof r.type === "string" ? r.type : undefined,
        tmdbTv: id(tmdb.tv),
        tmdbMovie: id(Array.isArray(tmdb.movie) ? tmdb.movie[0] : tmdb.movie),
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

  private async load(download: boolean) {
    let stored = await this.store.read().catch(() => null);
    if (download && (!stored || Date.now() - stored.savedAt >= MAX_AGE_MS)) {
      try {
        const raw = await this.download();
        await this.store.write(raw);
        stored = { savedAt: Date.now(), raw };
      } catch (err) {
        // Keep working from an older copy when GitHub is unreachable; without one, try
        // again in 15 minutes rather than on every lookup.
        log.warn("Couldn't refresh the anime id list", err);
        if (!stored) {
          this.loadedAt = Date.now() - MAX_AGE_MS + RETRY_MS;
          return;
        }
      }
    }
    // Nothing stored yet and not ours to download (Workers): the daily job brings it.
    if (!stored) {
      this.loadedAt = Date.now() - MAX_AGE_MS + RETRY_MS;
      return;
    }
    this.index(stored.raw);
    log.info(`Anime id list: ${this.byAnilist.size} AniList / ${this.byTv.size} TMDB shows`);
  }

  /** The list, cut down to the fields `index` reads (about a fifth of its 10+ MB). */
  private async download(): Promise<RawEntry[]> {
    const res = await this.fetchImpl(ANIME_LIST_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`anime-lists: HTTP ${res.status}`);
    const parsed = (await res.json()) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1000) throw new Error("anime-lists: unexpected content");
    return (parsed as RawEntry[]).map((r) => ({
      anilist_id: r.anilist_id,
      kitsu_id: r.kitsu_id,
      mal_id: r.mal_id,
      anidb_id: r.anidb_id,
      type: r.type,
      themoviedb_id: r.themoviedb_id,
      season: r.season,
      episode_offset: r.episode_offset,
    }));
  }
}

/** Where the downloaded anime id list is kept between starts. */
export interface AnimeIdStore {
  read(): Promise<{ savedAt: number; raw: RawEntry[] } | null>;
  write(raw: RawEntry[]): Promise<void>;
}

/** A file in the data folder (home server). */
export function fileAnimeIdStore(cacheDir: string): AnimeIdStore {
  const file = join(cacheDir, "anime-ids.json");
  return {
    async read() {
      if (!existsSync(file)) return null;
      try {
        return { savedAt: statSync(file).mtimeMs, raw: JSON.parse(readFileSync(file, "utf8")) as RawEntry[] };
      } catch {
        rmSync(file, { force: true }); // unreadable: the next load downloads it again
        return null;
      }
    },
    async write(raw) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(raw));
      renameSync(`${file}.tmp`, file);
    },
  };
}

/** The shared cache in the database (cloud server). */
export function cachedAnimeIdStore(cache: ApiCache): AnimeIdStore {
  const key = "anime-ids:list";
  return {
    async read() {
      const entry = await cache.read(key);
      return entry ? { savedAt: entry.fetchedAt, raw: entry.value as RawEntry[] } : null;
    },
    write: (raw) => cache.write(key, raw),
  };
}

/**
 * The entry a TMDB episode belongs to, among `entries` that have `key` (an AniList or
 * Kitsu id), and its episode number within that entry. Both sites have one entry per
 * season or cour, numbered from 1:
 * - an entry in the episode's TMDB season: the one with the largest offset before it
 *   (Frieren S2 is TMDB S1 from episode 29: S1E30 is its episode 2);
 * - else an entry numbered absolutely across TMDB's seasons (One Piece): the episode's
 *   absolute number, less the episodes before that entry's first.
 * Null when no entry covers it.
 */
export function entryEpisode(
  entries: AnimeEntry[],
  key: "anilistId" | "kitsuId",
  season: number,
  episode: number,
  tmdbSeasons: { season: number; episodes: number }[],
): { id: number; episode: number } | null {
  const inSeason = entries
    .filter((e) => e[key] && e.tmdbSeason === season && e.tmdbOffset < episode)
    .sort((a, b) => b.tmdbOffset - a.tmdbOffset)[0];
  if (inSeason) return { id: inSeason[key]!, episode: episode - inSeason.tmdbOffset };
  const before = tmdbSeasons.filter((s) => s.season > 0 && s.season < season).reduce((sum, s) => sum + s.episodes, 0);
  const absolute = before + episode;
  const entry = entries
    .filter((e) => e[key] && e.tmdbSeason === undefined && e.tmdbOffset < absolute)
    .sort((a, b) => b.tmdbOffset - a.tmdbOffset)[0];
  return entry ? { id: entry[key]!, episode: absolute - entry.tmdbOffset } : null;
}

/** The AniList entry and its own episode number for a TMDB episode (see `entryEpisode`). */
export function anilistEpisode(entries: AnimeEntry[], season: number, episode: number, tmdbSeasons: { season: number; episodes: number }[]): { anilistId: number; episode: number } | null {
  const at = entryEpisode(entries, "anilistId", season, episode, tmdbSeasons);
  return at && { anilistId: at.id, episode: at.episode };
}

/**
 * The Kitsu id and episode for a TMDB episode, as Torrentio's anime streams want them
 * ("kitsu:<id>:<episode>"; Kitsu has one entry per season or cour).
 */
export function kitsuEpisode(entries: AnimeEntry[], season: number, episode: number, tmdbSeasons: { season: number; episodes: number }[]): { kitsuId: number; episode: number } | null {
  const at = entryEpisode(entries, "kitsuId", season, episode, tmdbSeasons);
  return at && { kitsuId: at.id, episode: at.episode };
}

/**
 * Where an AniList entry's episode `n` sits on TMDB: its season from its offset, or
 * counted across TMDB's seasons when it's numbered absolutely. Null without a TMDB show.
 */
export function tmdbEpisodeOf(entry: AnimeEntry, n: number, tmdbSeasons: { season: number; episodes: number }[]): { season: number; episode: number } | null {
  if (!entry.tmdbTv) return null;
  if (entry.tmdbSeason !== undefined) return { season: entry.tmdbSeason, episode: entry.tmdbOffset + n };
  let remaining = entry.tmdbOffset + n;
  for (const s of [...tmdbSeasons].filter((x) => x.season > 0).sort((a, b) => a.season - b.season)) {
    if (s.episodes > 0 && remaining <= s.episodes) return { season: s.season, episode: remaining };
    remaining -= s.episodes;
  }
  return null;
}
