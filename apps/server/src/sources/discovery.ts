import { createHash } from "node:crypto";
import { type AnimeIds, kitsuEpisode, tmdbEpisodeOf } from "../catalog/anime/ids";
import { runtime } from "#runtime";
import type { Tmdb } from "../catalog/tmdb";
import type { FileRow, Library } from "../library";
import { logger } from "../log";
import { parseFileName, type ParsedName } from "../media/parse";
import type { Settings } from "../settings";
import { detailLabel, type Candidate } from "./resolver";
import type { TorboxClient, TorboxItem } from "./torbox/client";
import { ingestItem } from "./torbox/sync";
import { SharedWork } from "../inFlight";
import { AddonPausedError, type AddonHealth } from "./addonHealth";
import { globalFetch } from "../net";
import { targetRef, type TitleTarget } from "../catalog/ref";
import { addonStreams, defaultAddons, findsStreams, isBuiltIn, isInfoHash, manifestUrl, type StreamAddon } from "./addons";

export { isInfoHash, parseSize } from "./addons";

const log = logger("discovery");
const RELEASE_TTL_MS = 20 * 60_000;
/** Lookups kept at once (each is a few KB of releases). */
const RELEASE_CACHE_MAX = 300;
const SCRAPER_TIMEOUT_MS = 12_000;
const SCRAPER_BACKOFF_MS = 5 * 60_000;
const READY_WAIT_MS = 20_000;
/** Once some cached releases are in, how much longer a search waits for slower sources. */
const STRAGGLER_GRACE_MS = 3_000;

/** The movie or episode releases are looked for. */
export type DiscoveryTarget = TitleTarget;

/**
 * A release found by a scraper, not (yet) in the library: a torrent (keyed by its info-hash),
 * or an add-on's link (keyed "link:<digest of the link>", with `link` set).
 */
export interface Release {
  hash: string;
  /** A link stream: the add-on that gave it, and the link it plays from. */
  link?: { url: string; addonId: string; addonName: string };
  title: string;
  fileName?: string;
  size?: number;
  seeders?: number;
  /** Found by a Stremio add-on, or by TorBox's own search. */
  origin: "addon" | "torbox";
  cached: boolean;
  parsed: ParsedName;
  /** The release holds a whole season (or more), not just the requested episode. */
  isPack: boolean;
  /** The add-on says TorBox has it cached (a hint: TorBox's own answer decides). */
  addonCached?: boolean;
  /** Where its add-on put it: the add-on's place in the list, then the result's (lower is better). */
  addonOrder?: number;
  /** Audio languages (ISO 639-1, "multi" for several), when a source says. */
  languages?: string[];
  /** The add-on resolved it to the requested episode (asked by Kitsu id, for anime). */
  targeted?: boolean;
}

export type AcquireResult =
  | { status: "ready"; fileId: number }
  | { status: "downloading"; torrentId: number; progress: number; etaSeconds: number | null; name: string };

export class NotReadyError extends Error {
  constructor(readonly info: Extract<AcquireResult, { status: "downloading" }>) {
    super("TorBox is fetching it. It starts playing as soon as it's ready.");
  }
}

/** A release that turned out not to have the title in it (a pack of other seasons, say). */
export class NoPlayableFileError extends Error {
  constructor() {
    super("That release doesn't have this in it");
  }
}

export class Discovery {
  /** Releases found per title, for a few minutes (on Workers only finished searches are shared). */
  /** Whole searches; a partial one (sources left behind) is shared while it runs but not kept. */
  private cache = new SharedWork<string, { releases: Release[]; partial: boolean }>({ remember: true, ttlMs: RELEASE_TTL_MS, max: RELEASE_CACHE_MAX });
  /** Each source's answer on its own, so one too slow for a search is there for the next. */
  private sourceCache = new SharedWork<string, Release[]>({ remember: true, ttlMs: RELEASE_TTL_MS, max: RELEASE_CACHE_MAX * 4 });
  /** Torrents we added that weren't ready yet, by hash. */
  private pending = new Map<string, number>();
  private scraperDown = new Map<string, number>();

  constructor(
    private readonly tmdb: Tmdb,
    private readonly library: Library,
    private readonly settings: () => Settings,
    private readonly torbox: () => TorboxClient | null,
    private readonly fetchImpl: typeof fetch = globalFetch,
    /** Told about every torrent discovery adds, so housekeeping can remove it later. */
    private readonly onAdded: (torrentId: number, hash: string, name?: string) => void = () => {},
    /** Anime id list, for asking add-ons by Kitsu id (much better anime coverage). */
    private readonly animeIds?: AnimeIds,
    /** Asked before anything is added to TorBox; throws to refuse (the household's daily limit). */
    private readonly allowAdd: () => Promise<void> = async () => {},
    /** The household's Stremio add-ons (the server's Torrentio until it sets up its own). */
    private readonly addons: () => StreamAddon[] = () => defaultAddons(),
    /** How each add-on is doing (the dashboard's status), and which are paused. */
    private readonly health?: AddonHealth,
    /** Seals a link stream's add-on and address for keeping in the library (see acquireLink). */
    private readonly sealLink?: (data: string) => string,
  ) {}

  /** Whether it can find anything: TorBox for torrents, or a stream add-on (whose links play without it). */
  get available(): boolean {
    if (!this.settings().discoveryEnabled) return false;
    return !!this.torbox() || this.addons().some((a) => a.enabled && findsStreams(a) && !isBuiltIn(a));
  }

  /** Releases for a title, ranked, excluding ones already in the library. */
  async candidates(target: DiscoveryTarget): Promise<Candidate[]> {
    if (!this.available) return [];
    const known = await this.library.knownHashes();
    const { showUncached } = this.settings();
    // Torrents play through TorBox; without it, only add-ons' links are on offer.
    const torbox = !!this.torbox();
    return (await this.releases(target))
      .filter((r) => !known.has(r.hash) && (r.cached || showUncached) && (r.link || torbox))
      .map((r) => ({
        id: r.link ? r.hash : `hash:${r.hash}`,
        fileId: 0,
        provider: r.link ? ("link" as const) : ("torbox" as const),
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
        languages: r.languages,
        isPack: r.isPack,
        label: r.title,
        originLabel: r.link?.addonName ?? "TorBox",
        detail: detailLabel(r.size ?? 0, r.seeders),
      }));
  }

  /** The release discovery would play automatically, if any is cached. */
  async bestCached(target: DiscoveryTarget): Promise<Release | undefined> {
    return (await this.cachedReleases(target))[0];
  }

  /** Cached releases in the order Play tries them: within the size limit first, best first. */
  async cachedReleases(target: DiscoveryTarget): Promise<Release[]> {
    const maxBytes = this.settings().maxReleaseSizeGb * 1024 ** 3;
    const torbox = !!this.torbox();
    const releases = (await this.releases(target)).filter((r) => r.cached && (r.link || torbox));
    const fits = (r: Release) => !maxBytes || !r.size || r.size <= maxBytes;
    return [...releases.filter(fits), ...releases.filter((r) => !fits(r))];
  }

  /** Drops remembered searches (the add-ons changed). */
  forget() {
    this.cache.clear();
    this.sourceCache.clear();
  }

  releases(target: DiscoveryTarget): Promise<Release[]> {
    const key = `${target.source}:${target.mediaType}:${target.titleId}:${target.season ?? ""}:${target.episode ?? ""}`;
    return this.cache.get(key, () => this.search(target, key), (v) => !v.partial).then((v) => v.releases);
  }

  /**
   * Makes a release playable: adds it to TorBox if needed, waits briefly for it to be
   * ready, and imports its files into the library matched to the target title.
   */
  async acquire(target: DiscoveryTarget, hash: string): Promise<AcquireResult> {
    if (hash.startsWith("link:")) return this.acquireLink(target, hash);
    hash = hash.toLowerCase();
    if (!isInfoHash(hash)) throw new Error("Invalid info-hash");
    const existing = this.pickFile(await this.library.byHash(hash), target);
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
        await this.allowAdd();
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
      await runtime.sleep(1_500);
    }

    if (!(item.download_present || item.download_finished)) {
      this.pending.set(hash, torrentId);
      return { status: "downloading", torrentId, progress: item.progress ?? 0, etaSeconds: item.eta ?? null, name: item.name };
    }
    this.pending.delete(hash);
    const rows = await ingestItem(this.library, "torrents", { ...item, hash: item.hash ?? hash });
    const release = (await this.releases(target).catch(() => [])).find((r) => r.hash === hash);
    await this.assignMatches(rows, target, release?.fileName);
    // Anything else in the torrent (collections, extras) goes through normal matching.
    runtime.background(this.library.matchPending().catch((err) => log.warn("Matching after import failed", err)));
    const file = this.pickFile(await this.library.byHash(hash), target);
    // Not removed here: other files may still match in the background (anime numbering),
    // and housekeeping already takes out what Strata added and nobody played.
    if (!file) throw new NoPlayableFileError();
    return { status: "ready", fileId: file.id };
  }

  /**
   * Makes a link stream playable: a library file for it, matched to the title, whose ref is
   * the add-on's link sealed (it carries the add-on's settings, often a debrid key). Only a
   * link discovery offered for this title qualifies. Followed afresh each time it plays.
   */
  private async acquireLink(target: DiscoveryTarget, key: string): Promise<AcquireResult> {
    const existing = this.pickFile(await this.library.byHash(key), target);
    if (existing) return { status: "ready", fileId: existing.id };
    const release = (await this.releases(target)).find((r) => r.hash === key && r.link);
    if (!release?.link) throw new NoPlayableFileError();
    if (!this.sealLink) throw new Error("Links can't be kept on this server");
    const parsed = parseFileName(release.fileName ?? release.title);
    const row = await this.library.upsert({
      provider: "link",
      ref: this.sealLink(JSON.stringify({ a: release.link.addonId, u: release.link.url })),
      name: release.fileName ?? release.title,
      size: release.size ?? 0,
      parsed,
      sourceHash: key,
    });
    const t = targetRef(target);
    if (target.mediaType === "movie") await this.library.setManualMatch(row.id, t, undefined, undefined, "matched");
    else await this.library.setManualMatch(row.id, t, target.source === "anilist" ? 1 : target.season, target.episode, "matched");
    return { status: "ready", fileId: row.id };
  }

  /**
   * Matches imported files to the title we know they belong to, skipping TMDB search.
   * Movies: only the file the scraper pointed at (or the largest one) — a torrent may be a
   * collection of many films. Shows: every file with a season/episode number.
   */
  private async assignMatches(rows: FileRow[], target: DiscoveryTarget, fileName?: string) {
    // Never relabel a file that's already matched (or hand-matched) to another title.
    rows = rows.filter((r) => !((r.matchStatus === "matched" || r.matchStatus === "manual") && r.titleId !== null && (r.source !== target.source || r.titleId !== target.titleId)));
    if (target.mediaType === "movie") {
      const movies = rows.filter((r) => (JSON.parse(r.parsedJson ?? "{}") as ParsedName).kind !== "episode");
      const pick = (fileName && movies.find((r) => r.name === fileName)) || movies.sort((a, b) => b.size - a.size)[0];
      if (pick) await this.library.setManualMatch(pick.id, targetRef(target), undefined, undefined, "matched");
      return;
    }
    // The file the scraper pointed at is this episode, whatever its own numbering says
    // ("[Group] Frieren - 30.mkv" is TMDB S1E30); the rest match as usual.
    const show = targetRef(target);
    let pointed = fileName ? rows.find((r) => r.name === fileName) : undefined;
    // An AniList episode's release: the scraper's file, or the torrent's only video. The
    // rest are left to the anime matcher (their numbering may not be AniList's).
    if (target.source === "anilist") {
      pointed ??= rows.length === 1 ? rows[0] : undefined;
      if (pointed) await this.library.setManualMatch(pointed.id, show, 1, target.episode, "matched");
      return;
    }
    if (pointed) await this.library.setManualMatch(pointed.id, show, target.season, target.episode, "matched");
    for (const row of rows) {
      if (row === pointed) continue;
      const parsed = JSON.parse(row.parsedJson ?? "{}") as ParsedName;
      if (parsed.anime) continue; // anime numbering: left to the anime matcher (matchPending)
      if (parsed.season !== undefined && parsed.episode !== undefined) {
        await this.library.setManualMatch(row.id, show, parsed.season, parsed.episode, "matched");
      }
    }
  }

  private pickFile(rows: FileRow[], target: DiscoveryTarget): FileRow | undefined {
    const matching = rows.filter(
      (r) =>
        r.source === target.source &&
        r.titleId === target.titleId &&
        (target.mediaType === "movie" ? r.mediaType === "movie" : r.mediaType === "episode" && r.season === target.season && r.episode === target.episode),
    );
    return matching.sort((a, b) => b.size - a.size)[0];
  }

  /**
   * Runs one scraper with a time limit. One that fails is skipped for a few minutes, so
   * an unreachable service (a host that stopped resolving) costs one log line, not one
   * per lookup.
   */
  private async scrape(name: string, run: () => Promise<Release[]>, addonId?: string): Promise<Release[]> {
    // An add-on's: its health record times it, and pauses it after failures in a row.
    if (addonId && this.health) {
      try {
        return await this.health.track(addonId, name, () => timeout(run(), name));
      } catch (err) {
        if (!(err instanceof AddonPausedError)) log.warn(`${name} failed`, err);
        throw err;
      }
    }
    const downUntil = this.scraperDown.get(name) ?? 0;
    // Fails rather than answering "nothing", so the empty answer isn't kept as this source's.
    if (Date.now() < downUntil) throw new Error(`${name} is skipped for now`);
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

  private async search(target: DiscoveryTarget, cacheKey: string): Promise<{ releases: Release[]; partial: boolean }> {
    // Scrapers are asked by IMDb id (looked up on TMDB) and, for anime, by Kitsu id. An
    // AniList title's TMDB title and numbering come from the anime id list.
    const tmdbTarget = target.source === "anilist" ? await this.tmdbTargetOf(target).catch(() => null) : target;
    const [imdbId, kitsu] = await Promise.all([tmdbTarget ? this.imdbId(tmdbTarget) : null, this.kitsuId(target).catch(() => null)]);
    if (!imdbId && !kitsu) return { releases: [], partial: false };
    const settings = this.settings();
    const client = this.torbox();
    const jobs: Promise<Release[]>[] = [];
    for (const [place, addon] of this.addons().entries()) {
      if (!addon.enabled || !findsStreams(addon)) continue;
      // Asked by Kitsu id only if it says it knows them (or doesn't say).
      const kitsuOk = !addon.idPrefixes || addon.idPrefixes.some((p) => p.startsWith("kitsu"));
      const key = `${addon.name} (${addon.id})`;
      // Its place in the list is set after the cache: moving it doesn't need a new search.
      const at = (r: Release[]) => r.map((x) => ({ ...x, addonOrder: place * 10_000 + (x.addonOrder ?? 0) }));
      // The built-in entry is the server's Torrentio and TorBox's own search, in its place.
      if (isBuiltIn(addon)) {
        const torrentio = this.serverTorrentio(settings.torrentioUrl);
        if (torrentio && imdbId && tmdbTarget) jobs.push(this.sourceCache.get(`strata:${cacheKey}:imdb`, () => this.scrape("Strata (Torrentio)", () => this.fromAddon(torrentio, imdbId, tmdbTarget), addon.id)).then(at));
        if (torrentio && kitsu) jobs.push(this.sourceCache.get(`strata:${cacheKey}:kitsu`, () => this.scrape("Strata (Torrentio)", () => this.fromAddon(torrentio, kitsu, target, true), addon.id)).then(at));
        if (imdbId && tmdbTarget && client) jobs.push(this.sourceCache.get(`torbox:${cacheKey}`, () => this.scrape("TorBox search", () => this.torboxSearch(client, imdbId, tmdbTarget), addon.id)).then(at));
        continue;
      }
      if (imdbId && tmdbTarget) jobs.push(this.sourceCache.get(`${addon.id}:${cacheKey}:imdb`, () => this.scrape(key, () => this.fromAddon(addon, imdbId, tmdbTarget), addon.id)).then(at));
      if (kitsu && kitsuOk) jobs.push(this.sourceCache.get(`${addon.id}:${cacheKey}:kitsu`, () => this.scrape(key, () => this.fromAddon(addon, kitsu, target, true), addon.id)).then(at));
    }

    // A partial answer isn't remembered: sources left behind finish into sourceCache, and
    // the next lookup puts them in.
    const { settled, partial } = await settleWithGrace(jobs, (r) => r.some((x) => x.cached || x.addonCached), STRAGGLER_GRACE_MS);

    const byHash = new Map<string, Release>();
    for (const result of settled) {
      if (result.status === "rejected") {
        continue;
      }
      for (const r of result.value) {
        const prev = byHash.get(r.hash);
        // Prefer whichever source knows more (TorBox knows cache state; add-ons the file).
        byHash.set(
          r.hash,
          prev
            ? {
                ...prev,
                ...r,
                cached: prev.cached || r.cached,
                addonCached: prev.addonCached || r.addonCached,
                fileName: prev.fileName ?? r.fileName,
                seeders: Math.max(prev.seeders ?? 0, r.seeders ?? 0),
                addonOrder: Math.min(prev.addonOrder ?? Infinity, r.addonOrder ?? Infinity),
                languages: prev.languages || r.languages ? [...new Set([...(prev.languages ?? []), ...(r.languages ?? [])])] : undefined,
                parsed: { ...prev.parsed, ...Object.fromEntries(Object.entries(r.parsed).filter(([, v]) => v !== undefined)) } as ParsedName,
              }
            : r,
        );
      }
    }

    // Releases found by IMDb id are checked against TMDB's numbering; Kitsu's are the episode.
    // Torrents need TorBox to play; links play from their add-on.
    let releases = [...byHash.values()].filter((r) => relevant(r, tmdbTarget ?? target));
    // A link is as ready as its add-on says.
    releases = releases.map((r) => (r.link ? { ...r, cached: r.addonCached === true } : r));
    // Fill in cache state for releases TorBox's search didn't report on.
    // TorBox says what it has cached; an add-on's word for it only counts if TorBox can't be asked.
    const unknown = releases.filter((r) => !r.cached && !r.link).map((r) => r.hash);
    if (client && unknown.length) {
      try {
        const cached = await client.checkCached(unknown);
        releases = releases.map((r) => (cached.has(r.hash) ? { ...r, cached: true } : r));
      } catch (err) {
        log.warn("TorBox cache check failed", err);
        releases = releases.map((r) => (r.addonCached ? { ...r, cached: true } : r));
      }
    }
    return { releases: rankReleases(releases, settings), partial };
  }

  /**
   * The ids Stremio add-ons know a title by: IMDb ("tt…", ":S:E" added for an episode, in
   * TMDB's numbering) and, for anime, Kitsu ("kitsu:<id>[:<episode>]"). Either may be null.
   */
  async stremioIds(target: DiscoveryTarget): Promise<{ imdb: string | null; kitsu: string | null }> {
    const tmdbTarget = target.source === "anilist" ? await this.tmdbTargetOf(target).catch(() => null) : target;
    const [imdbId, kitsu] = await Promise.all([tmdbTarget ? this.imdbId(tmdbTarget).catch(() => null) : null, this.kitsuId(target).catch(() => null)]);
    const imdb = imdbId && tmdbTarget ? (tmdbTarget.mediaType === "movie" ? imdbId : `${imdbId}:${tmdbTarget.season}:${tmdbTarget.episode}`) : null;
    return { imdb, kitsu };
  }

  /** The server's Torrentio (its admin sets the address), as an add-on the Strata entry asks. */
  private serverTorrentio(url: string): StreamAddon | null {
    if (!url) return null;
    try {
      return { id: "strata-torrentio", url: manifestUrl(url), name: "Torrentio", enabled: true, resources: ["stream"], idPrefixes: ["tt", "kitsu"], subtitleIdPrefixes: null, catalogs: [], kind: "stremio", configurable: false, allowPrivate: true };
    } catch {
      return null;
    }
  }

  private async imdbId(target: DiscoveryTarget): Promise<string | null> {
    if (target.source !== "tmdb") return null;
    if (target.mediaType === "movie") {
      const m = await this.tmdb.movie(target.titleId);
      return m.imdb_id ?? m.external_ids?.imdb_id ?? null;
    }
    return (await this.tmdb.show(target.titleId)).external_ids?.imdb_id ?? null;
  }

  /**
   * An AniList target as TMDB's title and numbering, where the anime id list maps it
   * (Frieren S2's episode 2 is TMDB S1E30), else null.
   */
  private async tmdbTargetOf(target: DiscoveryTarget): Promise<DiscoveryTarget | null> {
    if (!this.animeIds) return null;
    await this.animeIds.ready();
    const entry = this.animeIds.anilist(target.titleId);
    if (target.mediaType === "movie") return entry?.tmdbMovie ? { source: "tmdb", mediaType: "movie", titleId: entry.tmdbMovie } : null;
    if (!entry?.tmdbTv || target.episode === undefined) return null;
    const seasons = entry.tmdbSeason === undefined ? (await this.tmdb.show(entry.tmdbTv)).seasons.map((s) => ({ season: s.season_number, episodes: s.episode_count })) : [];
    const at = tmdbEpisodeOf(entry, target.episode, seasons);
    return at ? { source: "tmdb", mediaType: "episode", titleId: entry.tmdbTv, season: at.season, episode: at.episode } : null;
  }

  /** "kitsu:<id>" / "kitsu:<id>:<episode>" for anime titles, else null. */
  private async kitsuId(target: DiscoveryTarget): Promise<string | null> {
    if (!this.animeIds) return null;
    await this.animeIds.ready();
    // Kitsu, like AniList, has an entry per season or cour: the episode number carries over.
    if (target.source === "anilist") {
      const id = this.animeIds.anilist(target.titleId)?.kitsuId;
      if (!id) return null;
      return target.mediaType === "movie" ? `kitsu:${id}` : `kitsu:${id}:${target.episode}`;
    }
    if (target.mediaType === "movie") {
      const id = this.animeIds.movie(target.titleId)?.kitsuId;
      return id ? `kitsu:${id}` : null;
    }
    const entries = this.animeIds.show(target.titleId);
    if (!entries.length) return null;
    const show = await this.tmdb.show(target.titleId);
    const seasons = show.seasons.map((s) => ({ season: s.season_number, episodes: s.episode_count }));
    const at = kitsuEpisode(entries, target.season!, target.episode!, seasons);
    return at ? `kitsu:${at.kitsuId}:${at.episode}` : null;
  }

  /** `id` is an IMDb id (episodes get ":S:E" added) or a ready "kitsu:…" id. */
  private async fromAddon(addon: StreamAddon, imdbId: string, target: DiscoveryTarget, anime = false): Promise<Release[]> {
    const id = anime || target.mediaType === "movie" ? imdbId : `${imdbId}:${target.season}:${target.episode}`;
    const streams = await addonStreams(addon, target.mediaType === "movie" ? "movie" : "series", id, this.fetchImpl);
    return streams.map((s, i) => {
      const parsed = parseFileName(s.fileName ?? s.title);
      const link = s.link ? { url: s.link, addonId: addon.id, addonName: addon.name } : undefined;
      return {
        hash: s.hash ?? linkKey(s.link!),
        link,
        title: s.title,
        fileName: s.fileName,
        size: s.size,
        seeders: s.seeders,
        origin: "addon" as const,
        // Checked with TorBox below; the add-on's word is the fallback.
        cached: false,
        addonCached: s.cached === true,
        parsed: { ...parsed, resolution: parsed.resolution ?? s.resolution, hdr: parsed.hdr ?? s.hdr, videoCodec: parsed.videoCodec ?? s.videoCodec },
        addonOrder: i,
        languages: s.languages,
        isPack: target.mediaType === "episode" && !!s.fileName && parseFileName(s.title).episode === undefined,
        targeted: anime && target.mediaType === "episode",
      };
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

/** Drops cams and releases for the wrong episode/season or the wrong kind of title. */
export function relevant(r: Release, target: DiscoveryTarget): boolean {
  if (r.parsed.source === "cam") return false;
  // The add-on already picked this episode (anime numbering differs from TMDB's).
  if (r.targeted) return true;
  if (target.mediaType === "movie") return r.parsed.kind === "movie";
  const titleParse = parseFileName(r.title);
  if (r.parsed.kind === "episode" && r.fileName) {
    // The add-on already points at the episode's file inside the torrent.
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

type RankSettings = Pick<Settings, "maxResolution" | "maxReleaseSizeGb"> & Partial<Pick<Settings, "releaseOrder" | "language">>;

/**
 * Releases best first. Always: cached ones (they play at once), then ones in the
 * household's language, then ones within its quality and size limits. After that either
 * Strata's own order (resolution, single episodes before packs, source, then the add-ons'
 * order and seeders) or, with `releaseOrder: "addons"`, the order the add-ons gave (for
 * add-ons like AIOStreams that are set up to sort the way someone likes).
 */
export function rankReleases(releases: Release[], settings: RankSettings): Release[] {
  const maxBytes = settings.maxReleaseSizeGb * 1024 ** 3;
  const fits = (r: Release) => (r.parsed.resolution ?? 1080) <= settings.maxResolution && (!maxBytes || !r.size || r.size <= maxBytes);
  const lang = settings.language?.split("-")[0]?.toLowerCase();
  // Not known to lack it: no languages listed (usually the original audio), several, or it.
  const speaks = (r: Release) => !lang || !r.languages?.length || r.languages.includes("multi") || r.languages.includes(lang);
  const order = (r: Release) => r.addonOrder ?? Infinity;
  const byAddons = (a: Release, b: Release) => (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1);
  const byStrata = (a: Release, b: Release) =>
    (b.parsed.resolution ?? 0) - (a.parsed.resolution ?? 0) ||
    // Single-episode releases start faster than season packs.
    Number(a.isPack) - Number(b.isPack) ||
    (SOURCE_RANK[b.parsed.source ?? ""] ?? 1) - (SOURCE_RANK[a.parsed.source ?? ""] ?? 1);
  return [...releases].sort(
    (a, b) =>
      Number(b.cached) - Number(a.cached) ||
      Number(speaks(b)) - Number(speaks(a)) ||
      Number(fits(b)) - Number(fits(a)) ||
      (settings.releaseOrder === "addons" ? byAddons(a, b) || byStrata(a, b) : byStrata(a, b) || byAddons(a, b)) ||
      (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}

/**
 * Waits for every job, unless `enough` is true of what's in by then: from then on it waits
 * at most `graceMs` for the rest. `partial` says some were left running.
 */
async function settleWithGrace<T>(jobs: Promise<T>[], enough: (value: T) => boolean, graceMs: number): Promise<{ settled: PromiseSettledResult<T>[]; partial: boolean }> {
  const results: (PromiseSettledResult<T> | undefined)[] = jobs.map(() => undefined);
  let left = jobs.length;
  if (!left) return { settled: [], partial: false };
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (partial: boolean) => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      left = -1;
      resolve({ settled: results.filter((r): r is PromiseSettledResult<T> => !!r), partial });
    };
    jobs.forEach((job, i) =>
      job.then(
        (value) => {
          if (left < 0) return;
          results[i] = { status: "fulfilled", value };
          if (--left === 0) return finish(false);
          if (!timer && enough(value)) timer = setTimeout(() => finish(true), graceMs);
        },
        (reason) => {
          if (left < 0) return;
          results[i] = { status: "rejected", reason };
          if (--left === 0) finish(false);
        },
      ),
    );
  });
}

class ScraperTimeout extends Error {}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new ScraperTimeout(`${label} timed out`)), SCRAPER_TIMEOUT_MS))]);
}

/** A link stream's key: "link:" and a digest of its address (so the address itself isn't the key). */
export function linkKey(url: string): string {
  return `link:${createHash("sha256").update(url).digest("hex").slice(0, 40)}`;
}
