import { lt } from "drizzle-orm";
import { tmdbCache } from "./db/schema";
import { join } from "node:path";
import { Auth } from "./auth";
import { CatalogService } from "./catalog/service";
import { CalendarService } from "./catalog/calendar";
import { Matcher } from "./catalog/matcher";
import { Tmdb } from "./catalog/tmdb";
import { dataPaths, type DataPaths, type RuntimeConfig } from "./config";
import { openDatabase, type Db } from "./db";
import { Jobs } from "./jobs";
import { Library } from "./library";
import { logger, setLogDir } from "./log";
import { PlaybackService } from "./playback/service";
import { SessionManager } from "./playback/sessions";
import { detectFfmpeg, type FfmpegInfo } from "./platform/ffmpeg";
import { installFfmpeg, type FfmpegSetup } from "./platform/ffmpegInstall";
import { KeepAwake } from "./platform/keepAwake";
import { ProgressStore } from "./progress";
import { ContentFilter } from "./catalog/contentRating";
import { Anilist } from "./catalog/anime/anilist";
import { Kitsu } from "./catalog/anime/kitsu";
import { AnimeIds } from "./catalog/anime/ids";
import { AnimeMatcher } from "./catalog/anime/match";
import { TorboxHousekeeping } from "./sources/torbox/cleanup";
import { DeviceLinks } from "./deviceLink";
import { SecretBox } from "./secrets";
import { SettingsStore } from "./settings";
import { scanLocal } from "./sources/local/scanner";
import { TorboxClient } from "./sources/torbox/client";
import { parseTorboxRef, syncTorbox } from "./sources/torbox/sync";
import { Discovery } from "./sources/discovery";
import { SubtitleService } from "./playback/subtitles";
import { Bonjour } from "./platform/bonjour";
import { loadServerId } from "./platform/network";
import { createUpdater, type Updater } from "./update";
import { API_VERSION, VERSION } from "./version";

const log = logger("server");
const MINUTE = 60_000;

export interface Services {
  config: RuntimeConfig;
  paths: DataPaths;
  db: Db;
  settings: SettingsStore;
  auth: Auth;
  deviceLinks: DeviceLinks;
  tmdb: Tmdb;
  library: Library;
  progress: ProgressStore;
  catalog: CatalogService;
  calendar: CalendarService;
  content: ContentFilter;
  sessions: SessionManager;
  playback: PlaybackService;
  discovery: Discovery;
  subtitles: SubtitleService;
  jobs: Jobs;
  /** Stable per-install id (advertised over Bonjour, returned by /api/info). */
  serverId: string;
  bonjour: Bonjour;
  updater: Updater;
  ffmpeg: () => FfmpegInfo | null;
  /** The one-time ffmpeg download, when the server had to set ffmpeg up itself. */
  ffmpegSetup: () => FfmpegSetup;
  torbox: () => TorboxClient | null;
  startedAt: number;
  shutdown: () => void;
}

export interface ServiceOverrides {
  fetch?: typeof fetch;
  ffmpeg?: FfmpegInfo | null;
}

export async function createServices(config: RuntimeConfig, overrides: ServiceOverrides = {}): Promise<Services> {
  const paths = dataPaths(config.dataDir);
  setLogDir(paths.logs);
  const db = openDatabase(paths.db, paths.backups);
  const settings = new SettingsStore(db, SecretBox.load(paths.secretKey));
  const fetchImpl = overrides.fetch ?? fetch;

  let ffmpegInfo = overrides.ffmpeg !== undefined ? overrides.ffmpeg : await detectFfmpeg(paths.root);
  const ffmpeg = () => ffmpegInfo;

  let torboxClient: { key: string; client: TorboxClient } | undefined;
  const torbox = () => {
    const key = settings.getSecret("torboxApiKey");
    if (!key) return null;
    if (torboxClient?.key !== key) torboxClient = { key, client: new TorboxClient(key, fetchImpl) };
    return torboxClient.client;
  };

  const tmdb = new Tmdb(db, () => settings.getSecret("tmdbApiKey"), () => settings.get().language, fetchImpl);
  const animeIds = new AnimeIds(join(paths.root, "cache"), fetchImpl);
  const anilist = new Anilist(db, fetchImpl);
  const kitsu = new Kitsu(db, fetchImpl);
  const library = new Library(db, tmdb, new Matcher(tmdb, new AnimeMatcher(anilist, animeIds, tmdb, kitsu)));
  const progress = new ProgressStore(db);
  const catalog = new CatalogService(tmdb, library, progress, () => settings.get(), { ids: animeIds, anilist, kitsu });
  const content = new ContentFilter(db, tmdb, () => settings.get());
  const calendar = new CalendarService(tmdb, library, progress, { ids: animeIds, anilist }, (profileId, id) => content.allowed(profileId, "show", id));
  const sessions = new SessionManager(paths.transcode, ffmpeg, new KeepAwake(), () => settings.get().maxTranscodes, () => settings.get().hardwareAcceleration);
  const subtitles = new SubtitleService(join(paths.root, "cache", "subtitles"), ffmpeg);
  const housekeeping = new TorboxHousekeeping(db, library);
  const discovery = new Discovery(tmdb, library, () => settings.get(), torbox, fetchImpl, (id, hash, name) => housekeeping.recordAdded(id, hash, name), animeIds);
  const playback = new PlaybackService(library, sessions, progress, () => settings.get(), ffmpeg, torbox, discovery, (id, s, e) => catalog.nextEpisode(id, s, e), (id) => housekeeping.recordPlayed(id));

  const jobs = new Jobs();
  jobs.register("scanLocal", (report) => scanLocal(library, settings.get().mediaFolders, report));
  jobs.register("syncTorbox", async (report) => {
    const client = torbox();
    if (!client) return { skipped: "TorBox not configured" };
    return syncTorbox(client, library, report);
  });
  jobs.register("matchPending", (report) => library.matchPending((d, t) => report(d, t, "Matching titles")));
  jobs.register("refreshAnimeIds", async () => {
    await animeIds.ready();
    return { entries: animeIds.size };
  });
  jobs.register("cleanTorbox", async () => {
    const client = torbox();
    if (!client) return { skipped: "TorBox not configured" };
    // Never pull a torrent out from under something that's streaming it (checked per torrent).
    const streaming = (id: number) =>
      sessions.list().some((s) => {
        const ref = library.get(s.fileId)?.ref;
        return !!ref?.startsWith("torrents:") && parseTorboxRef(ref).itemId === id;
      });
    return housekeeping.clean(client, settings.get().torboxCleanupDays, streaming);
  });
  // Catalog answers (TMDB, Kitsu, AniList) a month unused are only taking space.
  jobs.register("pruneCatalogCache", async () => {
    const removed = db.delete(tmdbCache).where(lt(tmdbCache.fetchedAt, Date.now() - 30 * 24 * 60 * MINUTE)).returning({ key: tmdbCache.key }).all().length;
    return { removed };
  });
  jobs.register("detectFfmpeg", async () => {
    ffmpegInfo = await detectFfmpeg(paths.root);
    return { found: !!ffmpegInfo };
  });
  // No ffmpeg on the machine: the server fetches its own (pinned, checksummed) into <data-dir>/bin.
  let ffmpegSetup: FfmpegSetup = { state: "idle" };
  jobs.register("installFfmpeg", async () => {
    if (ffmpegInfo) return { skipped: "ffmpeg is already available" };
    ffmpegSetup = { state: "downloading" };
    try {
      if (!(await installFfmpeg(paths.root, fetchImpl))) {
        ffmpegSetup = { state: "unsupported" };
        return { skipped: `no ffmpeg build for ${process.platform}-${process.arch}` };
      }
      ffmpegInfo = await detectFfmpeg(paths.root);
      ffmpegSetup = { state: "idle" };
      return { installed: !!ffmpegInfo };
    } catch (err) {
      ffmpegSetup = { state: "failed", error: err instanceof Error ? err.message : String(err) };
      throw err;
    }
  });
  if (!ffmpegInfo && overrides.ffmpeg === undefined && process.env.STRATA_NO_FFMPEG_DOWNLOAD !== "1") void jobs.run("installFfmpeg");

  const serverId = loadServerId(paths.root);
  const updater = createUpdater({ dataDir: paths.root, dbPath: paths.db, backupsDir: paths.backups, db, settings, activeSessions: () => sessions.list().length, fetch: fetchImpl });
  jobs.register("checkUpdates", () => updater.checkAndMaybeApply());
  // Started by main.ts once the HTTP server is listening; refreshed when the name/toggle changes.
  const bonjour = new Bonjour(() => {
    const s = settings.get();
    return s.bonjourEnabled ? { name: s.serverName, port: config.port, txt: { version: VERSION, api: String(API_VERSION), id: serverId } } : null;
  });
  settings.onChange(() => bonjour.refresh());

  const applySchedule = () => {
    const s = settings.get();
    jobs.schedule("scanLocal", s.scanIntervalMinutes * MINUTE, 5_000);
    jobs.schedule("syncTorbox", s.torboxSyncMinutes * MINUTE, 8_000);
  };
  let scheduled = { scan: -1, sync: -1, folders: "" };
  settings.onChange((s) => {
    const folders = JSON.stringify(s.mediaFolders);
    // Only reschedule (and kick a run) when something relevant changed.
    if (scheduled.scan !== s.scanIntervalMinutes || scheduled.sync !== s.torboxSyncMinutes || scheduled.folders !== folders) {
      if (scheduled.folders !== folders && scheduled.folders !== "") void jobs.run("scanLocal");
      scheduled = { scan: s.scanIntervalMinutes, sync: s.torboxSyncMinutes, folders };
      applySchedule();
    }
  });
  const initial = settings.get();
  scheduled = { scan: initial.scanIntervalMinutes, sync: initial.torboxSyncMinutes, folders: JSON.stringify(initial.mediaFolders) };
  if (process.env.STRATA_NO_JOBS !== "1") {
    applySchedule();
    jobs.schedule("checkUpdates", 6 * 60 * MINUTE, 60_000);
    jobs.schedule("cleanTorbox", 24 * 60 * MINUTE, 10 * MINUTE);
    jobs.schedule("pruneCatalogCache", 24 * 60 * MINUTE, 15 * MINUTE);
    jobs.schedule("refreshAnimeIds", 24 * 60 * MINUTE, 30_000);
  }

  const shutdown = () => {
    bonjour.stop();
    jobs.stop();
    sessions.stopAll();
    db.$client.close();
    log.info("Stopped");
  };

  return { config, paths, db, settings, auth: new Auth(db), deviceLinks: new DeviceLinks(), tmdb, library, progress, catalog, calendar, content, sessions, playback, discovery, subtitles, jobs, serverId, bonjour, updater, ffmpeg, ffmpegSetup: () => ffmpegSetup, torbox, startedAt: Date.now(), shutdown };
}
