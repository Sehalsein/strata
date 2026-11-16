import { CatalogService } from "./catalog/service";
import { CalendarService } from "./catalog/calendar";
import { ContentFilter } from "./catalog/contentRating";
import { Viewer } from "./catalog/viewer";
import { Matcher } from "./catalog/matcher";
import { AnimeMatcher } from "./catalog/anime/match";
import type { Anilist } from "./catalog/anime/anilist";
import type { AnimeIds } from "./catalog/anime/ids";
import type { Kitsu } from "./catalog/anime/kitsu";
import { Omdb } from "./catalog/omdb";
import { Tmdb } from "./catalog/tmdb";
import type { ApiCache } from "./catalog/apiCache";
import { ADDS_PER_HOUSEHOLD, PLAY_REPORTS_PER_USER, SEARCHES_PER_HOUSEHOLD, type Throttle } from "./throttle";
import type { Db } from "./db";
import { Library } from "./library";
import type { FfmpegInfo } from "./platform/ffmpeg";
import { PlaybackService, type UnlabeledTrack } from "./playback/service";
import { AddonSubtitleFinder, type OnlineSubtitle } from "./playback/addonSubtitles";
import { subtitleLanguagesOf } from "./playback/subtitleChoice";
import { toWebVtt } from "./playback/webvtt";
import { HouseholdPlays } from "./playback/plays";
import { PlayReports } from "./playback/reports";
import type { SessionManager } from "./playback/sessions";
import type { ProgressStore } from "./progress";
import type { SecretBox } from "./secrets";
import { householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, SettingsStore, type HouseholdSettingsStore, type ServerSettingsStore, type Settings } from "./settings";
import { Discovery } from "./sources/discovery";
import { AddonError, assertAddonReady, catalogKey, MAX_HOME_ROWS, defaultAddons, fetchSubtitleFile, findsSubtitles, inspectAddon, keepCatalogChoices, streamAddonListSchema, type StreamAddon } from "./sources/addons";
import { Buffer } from "node:buffer";
import { TitleIds } from "./catalog/titleIds";
import { AddonRows } from "./catalog/addonRows";
import { SharedWork } from "./inFlight";
import type { TitleTarget } from "./catalog/ref";
import { TorboxHousekeeping } from "./sources/torbox/cleanup";
import { TorboxClient } from "./sources/torbox/client";
import { syncTorbox } from "./sources/torbox/sync";
import { scanLocal } from "./sources/local/scanner";
import type { SecretKey } from "./settings";
import { runtime } from "#runtime";
import { AnimeMove } from "./jobs/anilistMove";

const MINUTE = 60_000;

const PROVIDER_NAMES: Record<SecretKey, string> = { tmdbApiKey: "TMDB", omdbApiKey: "OMDb", torboxApiKey: "TorBox" };

/** A key its provider didn't accept. */
export class KeyRejectedError extends Error {
  constructor(readonly key: SecretKey) {
    super(`${PROVIDER_NAMES[key]} rejected that key`);
  }
}

/** What every household shares: the server's settings, catalog clients and caches. */
export interface Shared {
  db: Db;
  box: SecretBox;
  serverSettings: ServerSettingsStore;
  /** TMDB and OMDb answers, cached for every household (they don't depend on whose key asked). */
  cache: ApiCache;
  /** Usage limits per household (release searches, TorBox additions). */
  throttle: Throttle;
  anime: { ids: AnimeIds; anilist: Anilist; kitsu: Kitsu };
  progress: ProgressStore;
  sessions: SessionManager;
  ffmpeg: () => FfmpegInfo | null;
  fetch: typeof fetch;
}

/**
 * One household's Strata: its library, catalog (with its library's availability),
 * playback, discovery and TorBox, over its own settings and TorBox key. Everything
 * reaches the database through the household-scoped stores (Library, its settings,
 * TorboxHousekeeping, ContentFilter, PlaybackService), so one household never sees
 * another's data.
 */
export class Household {
  readonly settingsStore: HouseholdSettingsStore;
  readonly library: Library;
  readonly catalog: CatalogService;
  readonly calendar: CalendarService;
  readonly content: ContentFilter;
  readonly discovery: Discovery;
  readonly housekeeping: TorboxHousekeeping;
  readonly playback: PlaybackService;
  /** The household's own plays (the server keeps everyone's). */
  readonly plays: HouseholdPlays;
  /** What went wrong with its plays, as its apps report it (for its admins). */
  readonly playReports: PlayReports;
  /** TMDB in the household's language, with its key (or the server's). */
  readonly tmdb: Tmdb;
  /** OMDb ratings, with its key (or the server's). */
  readonly omdb: Omdb;
  /** Other sites' ids for a title (IMDb, TVDB, Kitsu…) as Strata's own. */
  readonly titleIds: TitleIds;
  /** Subtitles from its subtitle add-ons. */
  readonly onlineSubtitles: AddonSubtitleFinder;
  /** Converted subtitle files, by the add-on's link. */
  private subtitleFiles = new SharedWork<string, string>({ remember: true, ttlMs: 6 * 3_600_000, max: 100 });
  private torboxClient?: { key: string; client: TorboxClient };

  /** Use `Households.get`: the settings must be loaded before the rest is built. */
  constructor(
    readonly organizationId: string,
    private readonly shared: Shared,
    settingsStore: HouseholdSettingsStore,
  ) {
    const { db } = shared;
    this.settingsStore = settingsStore;
    const settings = () => this.settings();
    this.tmdb = new Tmdb(shared.cache, () => settingsStore.getSecret("tmdbApiKey"), () => settingsStore.get().language, shared.fetch);
    this.omdb = new Omdb(shared.cache, () => settingsStore.getSecret("omdbApiKey"), shared.fetch);
    const tmdb = this.tmdb;
    this.library = new Library(db, organizationId, tmdb, new Matcher(tmdb, new AnimeMatcher(shared.anime.anilist, shared.anime.ids, tmdb, shared.anime.kitsu)), shared.anime.anilist);
    this.titleIds = new TitleIds(tmdb, shared.anime.ids);
    const addonRows = new AddonRows(() => this.addons(), this.titleIds, (refs) => this.catalog.titleCards(refs), (refs) => this.library.availability(refs), shared.fetch);
    this.catalog = new CatalogService(tmdb, this.library, shared.progress, settings, shared.anime, this.omdb, [addonRows]);
    this.content = new ContentFilter(db, organizationId, tmdb, settings, shared.anime);
    this.calendar = new CalendarService(tmdb, this.library, shared.progress, { ids: shared.anime.ids, anilist: shared.anime.anilist }, (userId, show) => this.content.allowed(userId, show));
    this.housekeeping = new TorboxHousekeeping(db, organizationId, this.library);
    this.plays = new HouseholdPlays(shared.sessions, organizationId, this.library);
    this.playReports = new PlayReports(db, organizationId);
    const torbox = () => this.torbox();
    this.discovery = new Discovery(tmdb, this.library, settings, torbox, shared.fetch, (id, hash, name) => this.housekeeping.recordAdded(id, hash, name), shared.anime.ids,
      () => shared.throttle.spend(`adds:${organizationId}`, ADDS_PER_HOUSEHOLD, "This household has added a lot of releases to TorBox today."),
      () => this.addons());
    this.onlineSubtitles = new AddonSubtitleFinder(() => this.addons(), (t) => this.discovery.stremioIds(t), () => this.subtitleLanguages(), shared.fetch);
    this.playback = new PlaybackService(this.library, shared.sessions, shared.progress, settings, shared.ffmpeg, torbox, this.discovery, (show, s, e) => this.catalog.nextEpisode(show, s, e), (id) => this.housekeeping.recordPlayed(id),
      (target) => this.subtitlesFor(target));
  }

  /** The languages its subtitle add-ons are asked for: as set, else the household's language. */
  subtitleLanguages(): string[] {
    return subtitleLanguagesOf(this.settings());
  }

  /** Subtitles the household's add-ons have for a title, as tracks the apps fetch from this server. */
  private async subtitlesFor(target: TitleTarget): Promise<UnlabeledTrack[]> {
    if (!this.onlineSubtitles.active) return [];
    const found = await this.onlineSubtitles.find(target);
    return found.map((s, i) => ({
      id: `a${i}`,
      codec: "webvtt",
      language: s.language,
      forced: false,
      isDefault: false,
      external: true,
      detail: s.rank > 1 ? `${s.source} · ${s.rank}` : s.source,
      url: `/api/subtitles/${this.subtitleToken(s)}.vtt`,
    }));
  }

  /**
   * A link to one add-on subtitle that only this server could have made, for this household.
   * The add-on and its file's address are sealed (encrypted and authenticated), so the apps
   * never see the address (it may hold the add-on's key) and can't point it anywhere else.
   */
  private subtitleToken(s: OnlineSubtitle): string {
    const sealed = this.shared.box.seal(JSON.stringify({ a: s.addonId, u: s.url }), `subtitle:${this.organizationId}`);
    return Buffer.from(sealed, "utf8").toString("base64url");
  }

  /**
   * The subtitle a token from `subtitlesFor` names, as WebVTT; null when the token isn't
   * this household's or its add-on is gone or off. Throws when the file can't be had.
   */
  async addonSubtitleVtt(token: string): Promise<string | null> {
    let claim: { a?: unknown; u?: unknown };
    try {
      claim = JSON.parse(this.shared.box.open(Buffer.from(token, "base64url").toString("utf8"), `subtitle:${this.organizationId}`));
    } catch {
      return null;
    }
    const addon = this.addons().find((a) => a.id === claim.a && a.enabled && findsSubtitles(a));
    if (!addon || typeof claim.u !== "string") return null;
    const url = claim.u;
    return this.subtitleFiles.get(url, async () => toWebVtt(await fetchSubtitleFile(url, addon, this.shared.fetch)));
  }

  /** One person's view of the catalog, with their content limit applied (see Viewer). */
  viewer(userId: string): Viewer {
    return new Viewer(this, userId);
  }

  private lastSyncAt = 0;

  /** Brings in what's new on the household's TorBox account and matches it. */
  async syncTorbox(): Promise<void> {
    const client = this.torbox();
    if (!client) return;
    this.lastSyncAt = Date.now();
    await syncTorbox(client, this.library, () => {});
    await this.library.matchPending();
  }

  /** The scheduled sync (every 15 minutes): at most every `torboxSyncMinutes`, never at 0. */
  async syncTorboxIfDue(): Promise<void> {
    const every = this.settings().torboxSyncMinutes * MINUTE;
    if (every === 0 || Date.now() - this.lastSyncAt < every - MINUTE) return;
    await this.syncTorbox();
  }

  /** Counts a playback problem report against the person's hourly allowance; throws past it. */
  spendPlayReport(userId: string): Promise<void> {
    return this.shared.throttle.spend(`play-reports:${this.organizationId}:${userId}`, PLAY_REPORTS_PER_USER, "These apps have reported a lot of playback problems in the last hour.");
  }

  /** Counts a release search (scrapers) against the household's hourly allowance; throws past it. */
  spendSearch(): Promise<void> {
    return this.shared.throttle.spend(`searches:${this.organizationId}`, SEARCHES_PER_HOUSEHOLD, "This household has searched for releases a lot in the last hour.");
  }

  /** Removes what housekeeping says is unused from TorBox, never a torrent that's streaming. */
  async cleanTorbox(): Promise<void> {
    const client = this.torbox();
    if (!client) return;
    await this.housekeeping.clean(client, this.settings().torboxCleanupDays, (id) => this.plays.streaming(id));
  }

  /** Moves the household's anime from TMDB titles to AniList's, once (see AnimeMove). */
  moveAnimeToAnilist() {
    return new AnimeMove(this.shared.db, this.organizationId, this.library, this.shared.anime, this.tmdb).run();
  }

  /** AniList, for the dashboard's Fix Match search. */
  get anilist(): Anilist {
    return this.shared.anime.anilist;
  }

  /** Scans the household's media folders on this server's disk. */
  scanFolders() {
    return scanLocal(this.library, this.settings().mediaFolders, () => {});
  }

  /**
   * Sets one of the household's keys (null removes it). A new key is checked with its
   * provider first (throws KeyRejectedError), and what it unlocks starts in the background:
   * a TorBox key syncs, a TMDB key matches what's waiting.
   */
  async setSecret(key: SecretKey, value: string | null): Promise<void> {
    if (value) {
      const ok =
        key === "tmdbApiKey" ? await this.tmdb.testKey(value)
        : key === "omdbApiKey" ? await this.omdb.testKey(value)
        : await new TorboxClient(value, this.shared.fetch).me().then(() => true, () => false);
      if (!ok) throw new KeyRejectedError(key);
    }
    await this.settingsStore.setSecret(key, value);
    if (value && key === "torboxApiKey") runtime.background(this.syncTorbox());
    if (key === "tmdbApiKey") runtime.background(this.library.matchPending());
  }

  /**
   * The Stremio add-ons the household finds releases with, in the order it lists them.
   * Until it changes the list, that's the server's Torrentio.
   */
  addons(): StreamAddon[] {
    const raw = this.settingsStore.getSecret("streamAddons");
    if (raw === undefined) return defaultAddons(this.shared.serverSettings.get().torrentioUrl);
    const parsed = streamAddonListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  }

  /**
   * Adds an add-on by its manifest URL, after checking it finds streams; throws AddonError.
   * `allowPrivate` (the server's admin only) lets it be on this machine or the home network.
   */
  async addAddon(url: string, allowPrivate = false): Promise<StreamAddon> {
    const found = await inspectAddon(url, this.shared.fetch, allowPrivate);
    await assertAddonReady(found, this.shared.fetch);
    const list = this.addons();
    if (list.some((a) => a.url === found.url)) throw new AddonError("That add-on is already in the list.");
    if (list.length >= MAX_ADDONS) throw new AddonError(`A household can have up to ${MAX_ADDONS} add-ons.`);
    // Its first catalogs start on Home, while there's room.
    let room = MAX_HOME_ROWS - list.reduce((n, a) => n + a.catalogs.filter((c) => c.home).length, 0);
    const catalogs = found.catalogs.map((c) => (c.home && room > 0 ? (room--, c) : { ...c, home: false }));
    const addon: StreamAddon = { ...found, catalogs, id: crypto.randomUUID(), enabled: true };
    await this.saveAddons([...list, addon]);
    return addon;
  }

  /**
   * Turns an add-on on or off, moves it (`index`), or says which of its catalogs are rows on
   * Home (`homeCatalogs`, by catalogKey); false when there's no such add-on.
   */
  async updateAddon(id: string, patch: { enabled?: boolean; index?: number; homeCatalogs?: string[] }): Promise<boolean> {
    const list = this.addons();
    const at = list.findIndex((a) => a.id === id);
    if (at < 0) return false;
    const [addon] = list.splice(at, 1);
    if (patch.enabled !== undefined) addon!.enabled = patch.enabled;
    if (patch.homeCatalogs) {
      const on = new Set(patch.homeCatalogs);
      const others = list.reduce((n, a) => n + a.catalogs.filter((c) => c.home).length, 0);
      const mine = addon!.catalogs.filter((c) => on.has(catalogKey(c))).length;
      if (others + mine > MAX_HOME_ROWS) throw new AddonError(`Home can show up to ${MAX_HOME_ROWS} add-on rows. Untick one first.`);
      addon!.catalogs = addon!.catalogs.map((c) => ({ ...c, home: on.has(catalogKey(c)) }));
    }
    list.splice(Math.max(0, Math.min(patch.index ?? at, list.length)), 0, addon!);
    await this.saveAddons(list);
    return true;
  }

  /** Points an add-on at another manifest URL (re-checked), keeping its place and switch. */
  async replaceAddon(id: string, url: string, allowPrivate = false): Promise<StreamAddon | null> {
    const list = this.addons();
    const at = list.findIndex((a) => a.id === id);
    if (at < 0) return null;
    const found = await inspectAddon(url, this.shared.fetch, allowPrivate);
    await assertAddonReady(found, this.shared.fetch);
    if (list.some((a, i) => i !== at && a.url === found.url)) throw new AddonError("That add-on is already in the list.");
    // A new id: it's no longer the server's default once it points somewhere else.
    const addon: StreamAddon = {
      ...found,
      catalogs: keepCatalogChoices(found.catalogs, list[at]!.catalogs),
      id: found.url === list[at]!.url ? id : crypto.randomUUID(),
      enabled: list[at]!.enabled,
    };
    list[at] = addon;
    await this.saveAddons(list);
    return addon;
  }

  /** Reads every add-on's manifest again (names, what it answers for); returns the ones that didn't answer. */
  async refreshAddons(): Promise<string[]> {
    const list = this.addons();
    const failed: string[] = [];
    const next = await Promise.all(
      list.map(async (a) => {
        try {
          const found = await inspectAddon(a.url, this.shared.fetch, a.allowPrivate);
          return { ...a, ...found, catalogs: keepCatalogChoices(found.catalogs, a.catalogs), id: a.id, enabled: a.enabled };
        } catch {
          failed.push(a.name);
          return a;
        }
      }),
    );
    await this.saveAddons(next);
    return failed;
  }

  async removeAllAddons(): Promise<void> {
    await this.saveAddons([]);
  }

  async removeAddon(id: string): Promise<boolean> {
    const list = this.addons();
    if (!list.some((a) => a.id === id)) return false;
    await this.saveAddons(list.filter((a) => a.id !== id));
    return true;
  }

  private async saveAddons(list: StreamAddon[]) {
    // An empty list is kept too: no add-ons is a choice, not "use the default".
    await this.settingsStore.setSecret("streamAddons", JSON.stringify(list));
    this.discovery.forget();
  }

  /** The server's settings with the household's on top. */
  settings(): Settings {
    return { ...this.shared.serverSettings.get(), ...this.settingsStore.get() };
  }

  /** The household's TorBox client, or null without a key. */
  torbox(): TorboxClient | null {
    const key = this.settingsStore.getSecret("torboxApiKey");
    if (!key) return null;
    if (this.torboxClient?.key !== key) this.torboxClient = { key, client: new TorboxClient(key, this.shared.fetch) };
    return this.torboxClient.client;
  }
}

/** Add-ons a household can list (each is asked on every search). */
const MAX_ADDONS = 10;

/** Households kept built at once; past this, the least recently used is let go. */
const KEPT_HOUSEHOLDS = 200;

/**
 * Households by id, built on first use and kept (the most recently used few hundred);
 * their settings are reloaded when older than a minute, in case another server changed them.
 */
export class Households {
  private loaded = new Map<string, Household>();

  constructor(private readonly shared: Shared) {}

  async get(organizationId: string): Promise<Household> {
    // Only a loaded household is shared: on Workers a load still running in another request
    // could be cancelled with it, and never finish.
    let household = this.loaded.get(organizationId);
    if (!household) {
      const store = new SettingsStore(this.shared.db, this.shared.box, householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, { kind: "household", organizationId });
      await store.load();
      household = this.loaded.get(organizationId) ?? new Household(organizationId, this.shared, store);
      this.keep(organizationId, household);
      return household;
    }
    this.keep(organizationId, household);
    await household.settingsStore.reloadIfOlderThan(60_000);
    return household;
  }

  /** Marks a household as just used (Maps keep insertion order); lets the oldest go past the cap. */
  private keep(organizationId: string, household: Household) {
    this.loaded.delete(organizationId);
    this.loaded.set(organizationId, household);
    if (this.loaded.size > KEPT_HOUSEHOLDS) this.loaded.delete(this.loaded.keys().next().value!);
  }

  /** Changes a household's settings; a new language rebuilds its catalog in that language. */
  async updateSettings(household: Household, patch: Parameters<HouseholdSettingsStore["update"]>[0]) {
    await household.settingsStore.update(patch);
    if ("language" in patch) this.drop(household.organizationId);
  }

  /** Forgets a household (deleted). */
  drop(organizationId: string) {
    this.loaded.delete(organizationId);
  }
}
