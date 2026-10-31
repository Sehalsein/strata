import { sql } from "drizzle-orm";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAuth, type Auth } from "./auth/betterAuth";
import { Tmdb } from "./catalog/tmdb";
import { Omdb } from "./catalog/omdb";
import { dataPaths, type DataPaths, type RuntimeConfig } from "./config";
import { closeDatabase, openDatabase, rowsOf, type Db } from "./db";
import { organization, user } from "./db/schema";
import { ApiCache } from "./catalog/apiCache";
import { Throttle } from "./throttle";
import { announceSetupCode } from "./setupCode";
import { isCloud, MODE } from "./mode";
import { Jobs } from "./jobs";
import { logger, setLogDir } from "./log";
import { SessionManager } from "./playback/sessions";
import { detectFfmpeg, type FfmpegInfo } from "./platform/ffmpeg";
import { installFfmpeg, type FfmpegSetup } from "./platform/ffmpegInstall";
import { KeepAwake } from "./platform/keepAwake";
import { ProgressStore } from "./progress";
import { Anilist } from "./catalog/anime/anilist";
import { Kitsu } from "./catalog/anime/kitsu";
import { AnimeIds, cachedAnimeIdStore, fileAnimeIdStore } from "./catalog/anime/ids";
import { SecretBox } from "./secrets";
import { serverSettingsSchema, SERVER_SECRET_KEYS, SettingsStore, type ServerSettingsStore } from "./settings";
import { scanLocal } from "./sources/local/scanner";
import { parseTorboxRef, syncTorbox } from "./sources/torbox/sync";
import { SubtitleService } from "./playback/subtitles";
import { Bonjour } from "./platform/bonjour";
import { createUpdater, type Updater } from "./update";
import { API_VERSION, VERSION } from "./version";
import { Households, type Household } from "./household";
import { runtime } from "#runtime";

const log = logger("server");
const MINUTE = 60_000;

export interface Services {
  config: RuntimeConfig;
  paths: DataPaths;
  db: Db;
  /** The server's own settings and the TMDB/OMDb keys (households have their own). */
  settings: ServerSettingsStore;
  /** Accounts, sign-in and households (Better Auth). */
  auth: Auth;
  households: Households;
  throttle: Throttle;
  cache: ApiCache;
  tmdb: (language: string) => Tmdb;
  omdb: Omdb;
  progress: ProgressStore;
  sessions: SessionManager;
  subtitles: SubtitleService;
  jobs: Jobs;
  /** Stable per-install id (advertised over Bonjour, returned by /api/info). */
  serverId: string;
  bonjour: Bonjour;
  updater: Updater;
  ffmpeg: () => FfmpegInfo | null;
  /** The one-time ffmpeg download, when the server had to set ffmpeg up itself. */
  ffmpegSetup: () => FfmpegSetup;
  /** Whether any account exists (setup has run). */
  hasAccounts: () => Promise<boolean>;
  /** Every household's id. */
  householdIds: () => Promise<string[]>;
  startedAt: number;
  shutdown: () => void;
}

export interface ServiceOverrides {
  fetch?: typeof fetch;
  ffmpeg?: FfmpegInfo | null;
}

export async function createServices(config: RuntimeConfig, overrides: ServiceOverrides = {}): Promise<Services> {
  const paths = dataPaths(config.dataDir);
  if (runtime.name === "bun") setLogDir(paths.logs);
  const db = await openDatabase(config.databaseUrl ?? paths.db);
  const box = SecretBox.load(isCloud ? null : paths.secretKey);
  const settings = new SettingsStore(db, box, serverSettingsSchema, SERVER_SECRET_KEYS);
  await settings.load();
  const fetchImpl = overrides.fetch ?? fetch;
  const cache = new ApiCache(db);
  const throttle = new Throttle(db);
  const auth = createAuth({ db, secretKey: box.signingKey(), baseURL: process.env.STRATA_PUBLIC_URL || undefined });
  const hasAccounts = async () => (await db.select({ id: user.id }).from(user).limit(1)).length > 0;
  const householdIds = async () => (await db.select({ id: organization.id }).from(organization)).map((o) => o.id);
  if (!(await hasAccounts())) await announceSetupCode(db);

  let ffmpegInfo = overrides.ffmpeg !== undefined ? overrides.ffmpeg : isCloud ? null : await detectFfmpeg(paths.root);
  const ffmpeg = () => ffmpegInfo;

  // TMDB answers are cached for every household; each language gets its own client.
  const tmdbByLanguage = new Map<string, Tmdb>();
  const tmdb = (language: string) => {
    let client = tmdbByLanguage.get(language);
    if (!client) tmdbByLanguage.set(language, (client = new Tmdb(cache, () => settings.getSecret("tmdbApiKey"), () => language, fetchImpl)));
    return client;
  };
  const omdb = new Omdb(cache, () => settings.getSecret("omdbApiKey"), fetchImpl);
  const anime = {
    ids: new AnimeIds(isCloud ? cachedAnimeIdStore(cache) : fileAnimeIdStore(join(paths.root, "cache")), fetchImpl),
    anilist: new Anilist(cache, fetchImpl),
    kitsu: new Kitsu(cache, fetchImpl),
  };
  const progress = new ProgressStore(db);
  const sessions = new SessionManager(
    db,
    isCloud ? null : { transcodeDir: paths.transcode, getFfmpeg: ffmpeg, keepAwake: new KeepAwake(), maxTranscodes: () => settings.get().maxTranscodes, hwAllowed: () => settings.get().hardwareAcceleration },
  );
  const subtitles = new SubtitleService(join(paths.root, "cache", "subtitles"), ffmpeg);
  const households = new Households({ db, box, serverSettings: settings, tmdb, omdb, anime, progress, sessions, ffmpeg, fetch: fetchImpl });

  /** Runs `fn` for every household, one after another; a failing one doesn't stop the rest. */
  const eachHousehold = async (what: string, fn: (h: Household) => Promise<unknown>) => {
    let done = 0;
    for (const id of await householdIds()) {
      try {
        await fn(await households.get(id));
        done++;
      } catch (err) {
        log.warn(`${what} failed for household ${id.slice(0, 8)}`, err);
      }
    }
    return { households: done };
  };

  const jobs = new Jobs();
  jobs.register("scanLocal", () => eachHousehold("Scanning folders", (h) => scanLocal(h.library, h.settings().mediaFolders, () => {})));
  // Each household with a key, at most every `torboxSyncMinutes` (the job itself runs every 15).
  const lastSync = new Map<string, number>();
  jobs.register("syncTorbox", () =>
    eachHousehold("TorBox sync", async (h) => {
      const client = h.torbox();
      const every = h.settings().torboxSyncMinutes * MINUTE;
      if (!client || every === 0 || Date.now() - (lastSync.get(h.organizationId) ?? 0) < every - MINUTE) return;
      lastSync.set(h.organizationId, Date.now());
      await syncTorbox(client, h.library, () => {});
      await h.library.matchPending();
    }),
  );
  jobs.register("matchPending", () => eachHousehold("Matching", (h) => h.library.matchPending()));
  jobs.register("refreshAnimeIds", async () => {
    await anime.ids.ready();
    return { entries: anime.ids.size };
  });
  jobs.register("cleanTorbox", () =>
    eachHousehold("TorBox cleanup", async (h) => {
      const client = h.torbox();
      if (!client) return;
      // Never pull a torrent out from under something that's streaming it (checked per torrent).
      const streaming = async (id: number) => {
        for (const s of await sessions.list()) {
          if (s.organizationId !== h.organizationId) continue;
          const ref = (await h.library.get(s.fileId))?.ref;
          if (ref?.startsWith("torrents:") && parseTorboxRef(ref).itemId === id) return true;
        }
        return false;
      };
      await h.housekeeping.clean(client, h.settings().torboxCleanupDays, streaming);
    }),
  );
  // Catalog answers (TMDB, Kitsu, AniList) a month unused are only taking space.
  jobs.register("pruneCatalogCache", async () => ({ removed: await cache.prune() }));
  // Plays long over and old failed-attempt counts (Better Auth expires its own sessions).
  jobs.register("pruneAuth", async () => {
    await sessions.prune();
    await throttle.prune();
    return {};
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
  // The cloud server plays nothing through ffmpeg (no local folders); only a home server fetches it.
  if (!isCloud && !ffmpegInfo && overrides.ffmpeg === undefined && process.env.STRATA_NO_FFMPEG_DOWNLOAD !== "1") void jobs.run("installFfmpeg");

  const serverId = await loadServerId(db, paths.root);
  // Only local streams run through this server; TorBox plays don't mind an update.
  const updater = runtime.name === "workers" ? workersUpdater() : createUpdater({ dataDir: paths.root, dbPath: paths.db, backupsDir: paths.backups, db, settings, activeSessions: () => sessions.activeTranscodes(), fetch: fetchImpl });
  jobs.register("checkUpdates", () => updater.checkAndMaybeApply());
  // Started by main.ts once the HTTP server is listening; refreshed when the name/toggle changes.
  const bonjour = new Bonjour(() => {
    const s = settings.get();
    return s.bonjourEnabled && !isCloud ? { name: s.serverName, port: config.port, txt: { version: VERSION, api: String(API_VERSION), id: serverId } } : null;
  });
  settings.onChange(() => bonjour.refresh());

  // In-process timers on Bun; Cron Triggers run the same jobs on Workers (src/worker.ts).
  if (process.env.STRATA_NO_JOBS !== "1") {
    if (!isCloud) jobs.schedule("scanLocal", Math.max(1, settings.get().scanIntervalMinutes) * MINUTE, 5_000);
    jobs.schedule("syncTorbox", 15 * MINUTE, 8_000);
    // The cloud image is updated by deploying a new one.
    if (!isCloud) jobs.schedule("checkUpdates", 6 * 60 * MINUTE, 60_000);
    jobs.schedule("pruneAuth", 24 * 60 * MINUTE, 5 * MINUTE);
    jobs.schedule("cleanTorbox", 24 * 60 * MINUTE, 10 * MINUTE);
    jobs.schedule("pruneCatalogCache", 24 * 60 * MINUTE, 15 * MINUTE);
    jobs.schedule("refreshAnimeIds", 24 * 60 * MINUTE, 30_000);
  }

  const shutdown = () => {
    bonjour.stop();
    jobs.stop();
    sessions.stopAll();
    void closeDatabase(db);
    log.info("Stopped");
  };
  log.info(`Running as a ${MODE} server`);

  return {
    config, paths, db, settings, auth, households, throttle, cache, tmdb, omdb, progress, sessions, subtitles, jobs, serverId, bonjour, updater, ffmpeg,
    ffmpegSetup: () => ffmpegSetup, hasAccounts, householdIds, startedAt: Date.now(), shutdown,
  };
}

/**
 * Stable id for this server (advertised over Bonjour, returned by /api/info), kept in the
 * database so every cloud instance shares it. A home server that had one in its data
 * folder keeps it.
 */
async function loadServerId(db: Db, dataDir: string): Promise<string> {
  const rows = rowsOf<{ value: string }>(await db.execute(sql`SELECT value FROM strata_meta WHERE key = 'server_id'`));
  if (rows[0]) return rows[0].value;
  const file = join(dataDir, "server-id");
  const id = !isCloud && existsSync(file) ? readFileSync(file, "utf8").trim() : randomUUID();
  await db.execute(sql`INSERT INTO strata_meta (key, value) VALUES ('server_id', ${id}) ON CONFLICT (key) DO NOTHING`);
  return id;
}

/** On Workers the server is updated by deploying it: there's nothing to check or apply. */
function workersUpdater(): Updater {
  const status = { state: "idle", updateAvailable: false, latest: null, lastError: null, disabledReason: "Deployed on Cloudflare: update by deploying a new version" };
  return {
    status: () => status,
    check: async () => status,
    checkAndMaybeApply: async () => {},
    apply: async () => {},
    onRestart: () => {},
  } as unknown as Updater;
}
