import { CatalogService } from "./catalog/service";
import { CalendarService } from "./catalog/calendar";
import { ContentFilter } from "./catalog/contentRating";
import { Matcher } from "./catalog/matcher";
import { AnimeMatcher } from "./catalog/anime/match";
import type { Anilist } from "./catalog/anime/anilist";
import type { AnimeIds } from "./catalog/anime/ids";
import type { Kitsu } from "./catalog/anime/kitsu";
import { Omdb } from "./catalog/omdb";
import { Tmdb } from "./catalog/tmdb";
import type { ApiCache } from "./catalog/apiCache";
import type { Db } from "./db";
import { Library } from "./library";
import type { FfmpegInfo } from "./platform/ffmpeg";
import { PlaybackService } from "./playback/service";
import type { SessionManager } from "./playback/sessions";
import type { ProgressStore } from "./progress";
import type { SecretBox } from "./secrets";
import { householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, SettingsStore, type HouseholdSettingsStore, type ServerSettingsStore, type Settings } from "./settings";
import { Discovery } from "./sources/discovery";
import { TorboxHousekeeping } from "./sources/torbox/cleanup";
import { TorboxClient } from "./sources/torbox/client";

/** What every household shares: the server's settings, catalog clients and caches. */
export interface Shared {
  db: Db;
  box: SecretBox;
  serverSettings: ServerSettingsStore;
  /** TMDB and OMDb answers, cached for every household (they don't depend on whose key asked). */
  cache: ApiCache;
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
    this.library = new Library(db, organizationId, tmdb, new Matcher(tmdb, new AnimeMatcher(shared.anime.anilist, shared.anime.ids, tmdb, shared.anime.kitsu)));
    this.catalog = new CatalogService(tmdb, this.library, shared.progress, settings, shared.anime, this.omdb);
    this.content = new ContentFilter(db, organizationId, tmdb, settings);
    this.calendar = new CalendarService(tmdb, this.library, shared.progress, { ids: shared.anime.ids, anilist: shared.anime.anilist }, (userId, id) => this.content.allowed(userId, "show", id));
    this.housekeeping = new TorboxHousekeeping(db, organizationId, this.library);
    const torbox = () => this.torbox();
    this.discovery = new Discovery(tmdb, this.library, settings, torbox, shared.fetch, (id, hash, name) => this.housekeeping.recordAdded(id, hash, name), shared.anime.ids);
    this.playback = new PlaybackService(this.library, shared.sessions, shared.progress, settings, shared.ffmpeg, torbox, this.discovery, (id, s, e) => this.catalog.nextEpisode(id, s, e), (id) => this.housekeeping.recordPlayed(id));
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

/**
 * Households by id, built on first use and kept (a few dozen at most); their settings
 * are reloaded when older than a minute, in case another server changed them.
 */
export class Households {
  private loaded = new Map<string, Promise<Household>>();

  constructor(private readonly shared: Shared) {}

  async get(organizationId: string): Promise<Household> {
    let pending = this.loaded.get(organizationId);
    if (!pending) {
      pending = (async () => {
        const store = new SettingsStore(this.shared.db, this.shared.box, householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, { kind: "household", organizationId });
        await store.load();
        return new Household(organizationId, this.shared, store);
      })();
      pending.catch(() => this.loaded.delete(organizationId));
      this.loaded.set(organizationId, pending);
    }
    const household = await pending;
    await household.settingsStore.reloadIfOlderThan(60_000);
    return household;
  }

  /** Forgets a household (deleted). */
  drop(organizationId: string) {
    this.loaded.delete(organizationId);
  }
}
