import { join } from "node:path";
import { Auth } from "./auth";
import { CatalogService } from "./catalog/service";
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
import { KeepAwake } from "./platform/keepAwake";
import { ProgressStore } from "./progress";
import { DeviceLinks } from "./deviceLink";
import { SecretBox } from "./secrets";
import { SettingsStore } from "./settings";
import { scanLocal } from "./sources/local/scanner";
import { TorboxClient } from "./sources/torbox/client";
import { syncTorbox } from "./sources/torbox/sync";
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
  const library = new Library(db, tmdb, new Matcher(tmdb));
  const progress = new ProgressStore(db);
  const catalog = new CatalogService(tmdb, library, progress, () => settings.get());
  const sessions = new SessionManager(paths.transcode, ffmpeg, new KeepAwake(), () => settings.get().maxTranscodes, () => settings.get().hardwareAcceleration);
  const subtitles = new SubtitleService(join(paths.root, "cache", "subtitles"), ffmpeg);
  const discovery = new Discovery(tmdb, library, () => settings.get(), torbox, fetchImpl);
  const playback = new PlaybackService(library, sessions, progress, () => settings.get(), ffmpeg, torbox, discovery, (id, s, e) => catalog.nextEpisode(id, s, e));

  const jobs = new Jobs();
  jobs.register("scanLocal", (report) => scanLocal(library, settings.get().mediaFolders, report));
  jobs.register("syncTorbox", async (report) => {
    const client = torbox();
    if (!client) return { skipped: "TorBox not configured" };
    return syncTorbox(client, library, report);
  });
  jobs.register("matchPending", (report) => library.matchPending((d, t) => report(d, t, "Matching titles")));
  jobs.register("backfillGenres", (report) => catalog.backfillGenres((d, t) => report(d, t, "Loading genres")));
  jobs.register("detectFfmpeg", async () => {
    ffmpegInfo = await detectFfmpeg(paths.root);
    return { found: !!ffmpegInfo };
  });

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
    jobs.schedule("backfillGenres", 6 * 60 * MINUTE, 20_000);
  }

  const shutdown = () => {
    bonjour.stop();
    jobs.stop();
    sessions.stopAll();
    db.$client.close();
    log.info("Stopped");
  };

  return { config, paths, db, settings, auth: new Auth(db), deviceLinks: new DeviceLinks(), tmdb, library, progress, catalog, sessions, playback, discovery, subtitles, jobs, serverId, bonjour, updater, ffmpeg, torbox, startedAt: Date.now(), shutdown };
}
