import { type AnimeIds, kitsuEpisode } from "../catalog/anime/ids";
import type { Tmdb } from "../catalog/tmdb";
import type { FileRow, Library } from "../library";
import { logger } from "../log";
import { isVideoFile, parseFileName, type ParsedName } from "../media/parse";
import type { Settings } from "../settings";
import { detailLabel, type Candidate } from "./resolver";
import type { TorboxClient, TorboxItem } from "./torbox/client";
import { ingestItem } from "./torbox/sync";

const log = logger("discovery");
const RELEASE_TTL_MS = 20 * 60_000;
/** Lookups kept at once (each is a few KB of releases). */
const RELEASE_CACHE_MAX = 300;
const SCRAPER_TIMEOUT_MS = 12_000;
const SCRAPER_BACKOFF_MS = 5 * 60_000;
const READY_WAIT_MS = 20_000;

export interface DiscoveryTarget {
  mediaType: "movie" | "episode";
  tmdbId: number;
  season?: number;
  episode?: number;
}

/** A torrent release found by a scraper, not (yet) in the library. */
export interface Release {
  hash: string;
  title: string;
  fileName?: string;
  size?: number;
  seeders?: number;
  origin: "torrentio" | "torbox";
  cached: boolean;
  parsed: ParsedName;
  /** The release holds a whole season (or more), not just the requested episode. */
  isPack: boolean;
  /** The scraper resolved it to the requested episode (Torrentio's anime/kitsu streams). */
  targeted?: boolean;
}

export type AcquireResult =
  | { status: "ready"; fileId: number }
  | { status: "downloading"; torrentId: number; progress: number; etaSeconds: number | null; name: string };

export class NotReadyError extends Error {
  constructor(readonly info: Extract<AcquireResult, { status: "downloading" }>) {
    super("This release is still downloading on TorBox");
  }
}

export class Discovery {
  private cache = new Map<string, { at: number; releases: Promise<Release[]> }>();
  /** Torrents we added that weren't ready yet, by hash. */
  private pending = new Map<string, number>();
  private scraperDown = new Map<string, number>();

  constructor(
    private readonly tmdb: Tmdb,
    private readonly library: Library,
    private readonly settings: () => Settings,
    private readonly torbox: () => TorboxClient | null,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Told about every torrent discovery adds, so housekeeping can remove it later. */
    private readonly onAdded: (torrentId: number, hash: string, name?: string) => void = () => {},
    /** Anime id list, for asking Torrentio by Kitsu id (much better anime coverage). */
    private readonly animeIds?: AnimeIds,
  ) {}

  get available(): boolean {
    return this.settings().discoveryEnabled && !!this.torbox();
  }

  /** Releases for a title, ranked, excluding ones already in the library. */
  async candidates(target: DiscoveryTarget): Promise<Candidate[]> {
    if (!this.available) return [];
    const known = this.library.knownHashes();
    const { showUncached } = this.settings();
    return (await this.releases(target))
      .filter((r) => !known.has(r.hash) && (r.cached || showUncached))
      .map((r) => ({
        id: `hash:${r.hash}`,
        fileId: 0,
        provider: "torbox" as const,
        name: r.fileName ?? r.title,
        size: r.size ?? 0,
        resolution: r.parsed.resolution,
        source: r.parsed.source,
        videoCodec: r.parsed.videoCodec,
        hdr: r.parsed.hdr ?? null,
        probed: false,
        availability: r.cached ? ("cached" as const) : ("uncached" as const),
        seeders: r.seeders,
        releaseTitle: r.title,
        isPack: r.isPack,
        label: r.title,
        originLabel: "TorBox",
        detail: detailLabel(r.size ?? 0, r.seeders),
      }));
  }

  /** The release discovery would play automatically, if any is cached. */
  async bestCached(target: DiscoveryTarget): Promise<Release | undefined> {
    const maxBytes = this.settings().maxReleaseSizeGb * 1024 ** 3;
    const releases = (await this.releases(target)).filter((r) => r.cached);
    return releases.find((r) => !maxBytes || !r.size || r.size <= maxBytes) ?? releases[0];
  }

  releases(target: DiscoveryTarget): Promise<Release[]> {
    const key = `${target.mediaType}:${target.tmdbId}:${target.season ?? ""}:${target.episode ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < RELEASE_TTL_MS) return hit.releases;
    const releases = this.search(target);
    this.pruneCache();
    this.cache.set(key, { at: Date.now(), releases });
    releases.catch(() => this.cache.delete(key));
    return releases;
  }

  /** Drops expired lookups, then the oldest beyond a cap, so browsing doesn't grow it forever. */
  private pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) if (now - entry.at >= RELEASE_TTL_MS) this.cache.delete(key);
    // Map keeps insertion order, so the first keys are the oldest.
    for (const key of this.cache.keys()) {
      if (this.cache.size < RELEASE_CACHE_MAX) break;
      this.cache.delete(key);
    }
  }

  /**
   * Makes a release playable: adds it to TorBox if needed, waits briefly for it to be
   * ready, and imports its files into the library matched to the target title.
   */
  async acquire(target: DiscoveryTarget, hash: string): Promise<AcquireResult> {
    hash = hash.toLowerCase();
    if (!isInfoHash(hash)) throw new Error("Invalid info-hash");
    const existing = this.pickFile(this.library.byHash(hash), target);
    if (existing) return { status: "ready", fileId: existing.id };

    const client = this.torbox();
    if (!client) throw new Error("TorBox is not configured");
    let torrentId = this.pending.get(hash);
    // Cached torrents turn ready within seconds of being added; real downloads take minutes,
    // so those return progress immediately and the client polls.
    let waitMs = 0;
    if (torrentId === undefined) {
      const release = (await this.releases(target)).find((r) => r.hash === hash);
      const magnet = new URLSearchParams({ xt: `urn:btih:${hash}` });
      if (release) magnet.set("dn", release.title);
      // Already in the account (added in TorBox itself, not synced yet)? Use it, and don't
      // record it as ours: housekeeping must never remove the user's own torrents.
      const owned = (await client.list("torrents")).find((t) => t.hash?.toLowerCase() === hash);
      if (owned) {
        torrentId = owned.id;
      } else {
        ({ torrentId } = await client.createTorrent(`magnet:?${magnet.toString().replace("urn%3Abtih%3A", "urn:btih:")}`));
        log.info(`Added ${release?.title ?? hash} to TorBox (#${torrentId})`);
        this.onAdded(torrentId, hash, release?.title);
      }
      if (release?.cached) waitMs = READY_WAIT_MS;
    }

    const deadline = Date.now() + waitMs;
    let item: TorboxItem;
    for (;;) {
      item = await client.torrent(torrentId);
      const ready = (item.download_present || item.download_finished) && (item.files?.length ?? 0) > 0;
      if (ready || Date.now() > deadline) break;
      await Bun.sleep(1_500);
    }

    if (!(item.download_present || item.download_finished)) {
      this.pending.set(hash, torrentId);
      return { status: "downloading", torrentId, progress: item.progress ?? 0, etaSeconds: item.eta ?? null, name: item.name };
    }
    this.pending.delete(hash);
    const rows = ingestItem(this.library, "torrents", { ...item, hash: item.hash ?? hash });
    const release = (await this.releases(target).catch(() => [])).find((r) => r.hash === hash);
    await this.assignMatches(rows, target, release?.fileName);
    // Anything else in the torrent (collections, extras) goes through normal matching.
    void this.library.matchPending().catch((err) => log.warn("Matching after import failed", err));
    const file = this.pickFile(this.library.byHash(hash), target);
    if (!file) throw new Error("The release has no playable file for this title");
    return { status: "ready", fileId: file.id };
  }

  /**
   * Matches imported files to the title we know they belong to, skipping TMDB search.
   * Movies: only the file the scraper pointed at (or the largest one) — a torrent may be a
   * collection of many films. Shows: every file with a season/episode number.
   */
  private async assignMatches(rows: FileRow[], target: DiscoveryTarget, fileName?: string) {
    // Never relabel a file that's already matched (or hand-matched) to another title.
    rows = rows.filter((r) => !((r.matchStatus === "matched" || r.matchStatus === "manual") && r.tmdbId !== null && r.tmdbId !== target.tmdbId));
    if (target.mediaType === "movie") {
      const movies = rows.filter((r) => (JSON.parse(r.parsedJson ?? "{}") as ParsedName).kind !== "episode");
      const pick = (fileName && movies.find((r) => r.name === fileName)) || movies.sort((a, b) => b.size - a.size)[0];
      if (pick) await this.library.setManualMatch(pick.id, "movie", target.tmdbId, undefined, undefined, "matched");
      return;
    }
    // The file the scraper pointed at is this episode, whatever its own numbering says
    // ("[Group] Frieren - 30.mkv" is TMDB S1E30); the rest match as usual.
    const pointed = fileName ? rows.find((r) => r.name === fileName) : undefined;
    if (pointed) await this.library.setManualMatch(pointed.id, "show", target.tmdbId, target.season, target.episode, "matched");
    for (const row of rows) {
      if (row === pointed) continue;
      const parsed = JSON.parse(row.parsedJson ?? "{}") as ParsedName;
      if (parsed.anime) continue; // anime numbering: left to the anime matcher (matchPending)
      if (parsed.season !== undefined && parsed.episode !== undefined) {
        await this.library.setManualMatch(row.id, "show", target.tmdbId, parsed.season, parsed.episode, "matched");
      }
    }
  }

  private pickFile(rows: FileRow[], target: DiscoveryTarget): FileRow | undefined {
    const matching = rows.filter((r) =>
      target.mediaType === "movie"
        ? r.mediaType === "movie" && r.tmdbId === target.tmdbId
        : r.mediaType === "episode" && r.tmdbId === target.tmdbId && r.season === target.season && r.episode === target.episode,
    );
    return matching.sort((a, b) => b.size - a.size)[0];
  }

  /**
   * Runs one scraper with a time limit. One that fails is skipped for a few minutes, so
   * an unreachable service (a host that stopped resolving) costs one log line, not one
   * per lookup.
   */
  private async scrape(name: string, run: () => Promise<Release[]>): Promise<Release[]> {
    const downUntil = this.scraperDown.get(name) ?? 0;
    if (Date.now() < downUntil) return [];
    try {
      const releases = await timeout(run(), name);
      this.scraperDown.delete(name);
      return releases;
    } catch (err) {
      // A slow answer is worth trying again next time; a connection that fails isn't.
      if (err instanceof ScraperTimeout) {
        log.warn(`${name} timed out`);
      } else {
        log.warn(`${name} failed; skipping it for ${SCRAPER_BACKOFF_MS / 60_000} minutes`, err);
        this.scraperDown.set(name, Date.now() + SCRAPER_BACKOFF_MS);
      }
      throw err;
    }
  }

  private async search(target: DiscoveryTarget): Promise<Release[]> {
    const imdbId = await this.imdbId(target);
    if (!imdbId) return [];
    const settings = this.settings();
    const client = this.torbox();
    const jobs: Promise<Release[]>[] = [];
    if (settings.torrentioUrl) {
      const base = settings.torrentioUrl;
      jobs.push(this.scrape("Torrentio", () => this.torrentio(base, imdbId, target)));
      const kitsu = await this.kitsuId(target).catch(() => null);
      if (kitsu) jobs.push(this.scrape("Torrentio", () => this.torrentio(base, kitsu, target, true)));
    }
    if (settings.useTorboxSearch && client) jobs.push(this.scrape("TorBox search", () => this.torboxSearch(client, imdbId, target)));

    const byHash = new Map<string, Release>();
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === "rejected") {
        continue;
      }
      for (const r of result.value) {
        const prev = byHash.get(r.hash);
        // Prefer whichever source knows more (TorBox knows cache state; Torrentio the file).
        byHash.set(r.hash, prev ? { ...prev, ...r, cached: prev.cached || r.cached, fileName: prev.fileName ?? r.fileName, seeders: Math.max(prev.seeders ?? 0, r.seeders ?? 0) } : r);
      }
    }

    let releases = [...byHash.values()].filter((r) => relevant(r, target));
    // Fill in cache state for releases TorBox's search didn't report on.
    const unknown = releases.filter((r) => r.origin === "torrentio" && !r.cached).map((r) => r.hash);
    if (client && unknown.length) {
      try {
        const cached = await client.checkCached(unknown);
        releases = releases.map((r) => (cached.has(r.hash) ? { ...r, cached: true } : r));
      } catch (err) {
        log.warn("TorBox cache check failed", err);
      }
    }
    return rankReleases(releases, settings);
  }

  private async imdbId(target: DiscoveryTarget): Promise<string | null> {
    if (target.mediaType === "movie") {
      const m = await this.tmdb.movie(target.tmdbId);
      return m.imdb_id ?? m.external_ids?.imdb_id ?? null;
    }
    return (await this.tmdb.show(target.tmdbId)).external_ids?.imdb_id ?? null;
  }

  /** "kitsu:<id>" / "kitsu:<id>:<episode>" for anime titles, else null. */
  private async kitsuId(target: DiscoveryTarget): Promise<string | null> {
    if (!this.animeIds) return null;
    await this.animeIds.ready();
    if (target.mediaType === "movie") {
      const id = this.animeIds.movie(target.tmdbId)?.kitsuId;
      return id ? `kitsu:${id}` : null;
    }
    const entries = this.animeIds.show(target.tmdbId);
    if (!entries.length) return null;
    const show = await this.tmdb.show(target.tmdbId);
    const seasons = show.seasons.map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const at = kitsuEpisode(entries, target.season!, target.episode!, seasons);
    return at ? `kitsu:${at.kitsuId}:${at.episode}` : null;
  }

  /** `id` is an IMDb id (episodes get ":S:E" added) or a ready "kitsu:…" id. */
  private async torrentio(base: string, imdbId: string, target: DiscoveryTarget, anime = false): Promise<Release[]> {
    const id = anime || target.mediaType === "movie" ? imdbId : `${imdbId}:${target.season}:${target.episode}`;
    const url = `${base.replace(/\/+$/, "").replace(/\/manifest\.json$/, "")}/stream/${target.mediaType === "movie" ? "movie" : "series"}/${id}.json`;
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Torrentio ${res.status}`);
    const body = (await res.json()) as { streams?: TorrentioStream[] };
    return (body.streams ?? []).flatMap((s) => {
      if (!s.infoHash || !isInfoHash(s.infoHash.toLowerCase())) return [];
      const lines = (s.title ?? "").split("\n");
      const title = lines[0]?.trim() || s.behaviorHints?.filename || "";
      const fileName = s.behaviorHints?.filename ?? (lines[1] && isVideoFile(lines[1].trim()) ? lines[1].trim() : undefined);
      const meta = lines.join(" ");
      const parsed = parseFileName(fileName ?? title);
      return [
        {
          hash: s.infoHash.toLowerCase(),
          title,
          fileName,
          size: parseSize(meta),
          seeders: Number(/👤\s*(\d+)/.exec(meta)?.[1] ?? 0) || undefined,
          origin: "torrentio" as const,
          cached: false,
          parsed: { ...parsed, resolution: parsed.resolution ?? resolutionFromName(s.name) },
          isPack: target.mediaType === "episode" && !!fileName && parseFileName(title).episode === undefined,
          targeted: anime && target.mediaType === "episode",
        },
      ];
    });
  }

  private async torboxSearch(client: TorboxClient, imdbId: string, target: DiscoveryTarget): Promise<Release[]> {
    const torrents = await client.search(imdbId, target.season, target.episode);
    return torrents.filter((t) => isInfoHash(t.hash?.toLowerCase() ?? "")).map((t) => {
      const parsed = parseFileName(t.raw_title);
      return {
        hash: t.hash.toLowerCase(),
        title: t.raw_title,
        size: t.size,
        seeders: t.last_known_seeders,
        origin: "torbox" as const,
        cached: !!t.cached || !!t.owned,
        parsed,
        isPack: target.mediaType === "episode" && parsed.episode === undefined,
      };
    });
  }
}

interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { filename?: string; bingeGroup?: string };
}

/** SHA-1 (v1) or SHA-256 (v2) BitTorrent info-hash, hex. */
export function isInfoHash(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

/** Drops cams and releases for the wrong episode/season or the wrong kind of title. */
export function relevant(r: Release, target: DiscoveryTarget): boolean {
  if (r.parsed.source === "cam") return false;
  // Torrentio already picked this episode (anime numbering differs from TMDB's).
  if (r.targeted) return true;
  if (target.mediaType === "movie") return r.parsed.kind === "movie";
  const titleParse = parseFileName(r.title);
  if (r.parsed.kind === "episode" && r.fileName) {
    // Torrentio already points at the episode's file inside the torrent.
    return r.parsed.season === target.season && r.parsed.episode === target.episode;
  }
  if (titleParse.kind === "episode") {
    const end = titleParse.episodeEnd ?? titleParse.episode!;
    return titleParse.season === target.season && titleParse.episode! <= target.episode! && target.episode! <= end;
  }
  // Season packs: "Show.S02.1080p", "Show Season 2", "Show S01-S05".
  const range = /\bS(\d{1,2})\s*-\s*S?(\d{1,2})\b/i.exec(r.title);
  if (range) return Number(range[1]) <= target.season! && target.season! <= Number(range[2]);
  const pack = /\bS(\d{1,2})\b(?!\s*E\d)|\bSeason[\s._-]*(\d{1,2})\b/i.exec(r.title);
  if (pack) return Number(pack[1] ?? pack[2]) === target.season;
  return /\bcomplete\b/i.test(r.title);
}

const SOURCE_RANK: Record<string, number> = { remux: 5, bluray: 4, web: 3, hdtv: 2, dvd: 1, cam: 0 };

export function rankReleases(releases: Release[], settings: Pick<Settings, "maxResolution" | "maxReleaseSizeGb">): Release[] {
  const maxBytes = settings.maxReleaseSizeGb * 1024 ** 3;
  const fits = (r: Release) => (r.parsed.resolution ?? 1080) <= settings.maxResolution && (!maxBytes || !r.size || r.size <= maxBytes);
  return [...releases].sort(
    (a, b) =>
      Number(b.cached) - Number(a.cached) ||
      Number(fits(b)) - Number(fits(a)) ||
      (b.parsed.resolution ?? 0) - (a.parsed.resolution ?? 0) ||
      // Single-episode releases start faster than season packs.
      Number(a.isPack) - Number(b.isPack) ||
      (SOURCE_RANK[b.parsed.source ?? ""] ?? 1) - (SOURCE_RANK[a.parsed.source ?? ""] ?? 1) ||
      (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}

export function parseSize(text: string): number | undefined {
  const m = /💾\s*([\d.]+)\s*(TB|GB|MB|KB)/i.exec(text) ?? /\b([\d.]+)\s*(TB|GB|MB)\b/i.exec(text);
  if (!m) return undefined;
  const mult = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[m[2]!.toUpperCase() as "TB" | "GB" | "MB" | "KB"];
  return Math.round(Number(m[1]) * mult);
}

function resolutionFromName(name?: string): number | undefined {
  if (!name) return undefined;
  if (/4k|2160/i.test(name)) return 2160;
  const m = /(1080|720|480)p?/i.exec(name);
  return m ? Number(m[1]) : undefined;
}

class ScraperTimeout extends Error {}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new ScraperTimeout(`${label} timed out`)), SCRAPER_TIMEOUT_MS))]);
}
