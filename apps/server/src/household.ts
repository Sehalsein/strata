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
import { ADDS_PER_HOUSEHOLD, SEARCHES_PER_HOUSEHOLD, type Throttle } from "./throttle";
import type { Db } from "./db";
import { Library } from "./library";
import type { FfmpegInfo } from "./platform/ffmpeg";
import { PlaybackService } from "./playback/service";
import { HouseholdPlays } from "./playback/plays";
import type { SessionManager } from "./playback/sessions";
import type { ProgressStore } from "./progress";
import type { SecretBox } from "./secrets";
import { householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, SettingsStore, type HouseholdSettingsStore, type ServerSettingsStore, type Settings } from "./settings";
import { Discovery } from "./sources/discovery";
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
  /** TMDB in the household's language, with its key (or the server's). */
  readonly tmdb: Tmdb;
  /** OMDb ratings, with its key (or the server's). */
  readonly omdb: Omdb;
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
    this.catalog = new CatalogService(tmdb, this.library, shared.progress, settings, shared.anime, this.omdb);
    this.content = new ContentFilter(db, organizationId, tmdb, settings, shared.anime);
    this.calendar = new CalendarService(tmdb, this.library, shared.progress, { ids: shared.anime.ids, anilist: shared.anime.anilist }, (userId, show) => this.content.allowed(userId, show));
    this.housekeeping = new TorboxHousekeeping(db, organizationId, this.library);
    this.plays = new HouseholdPlays(shared.sessions, organizationId, this.library);
    const torbox = () => this.torbox();
    this.discovery = new Discovery(tmdb, this.library, settings, torbox, shared.fetch, (id, hash, name) => this.housekeeping.recordAdded(id, hash, name), shared.anime.ids,
      () => shared.throttle.spend(`adds:${organizationId}`, ADDS_PER_HOUSEHOLD, "This household has added a lot of releases to TorBox today."));
    this.playback = new PlaybackService(this.library, shared.sessions, shared.progress, settings, shared.ffmpeg, torbox, this.discovery, (show, s, e) => this.catalog.nextEpisode(show, s, e), (id) => this.housekeeping.recordPlayed(id));
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
