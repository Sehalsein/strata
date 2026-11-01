import { homedir, platform, tmpdir } from "node:os";
import { defaultProfile } from "./profile";
import { runtime } from "#runtime";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface RuntimeConfig {
  dataDir: string;
  port: number;
  host: string;
  /** Directory of a built dashboard to serve from disk instead of the embedded copy (dev). */
  webDir?: string;
  /**
   * A Postgres server (`postgres://…`, e.g. Neon). Required in the cloud build; a home
   * server uses its bundled database in the data folder unless this is set.
   */
  databaseUrl?: string;
}

export function defaultDataDir(): string {
  if (process.env.STRATA_DATA_DIR) return process.env.STRATA_DATA_DIR;
  // The cloud server keeps nothing lasting on disk: only caches it can lose.
  // A server that keeps no state here (cloud) only needs a scratch folder for caches.
  if (!defaultProfile().localState) return join(tmpdir(), "strata");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Strata");
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdg, "strata");
}

export function parseArgs(argv: string[]): { command: string; config: RuntimeConfig } {
  let command = "serve";
  const config: RuntimeConfig = {
    dataDir: defaultDataDir(),
    port: Number(process.env.STRATA_PORT ?? 8420),
    host: process.env.STRATA_HOST ?? "0.0.0.0",
    webDir: process.env.STRATA_WEB_DIR,
    databaseUrl: process.env.DATABASE_URL || undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--data-dir") config.dataDir = next();
    else if (arg === "--port") config.port = Number(next());
    else if (arg === "--host") config.host = next();
    else if (arg === "--web-dir") config.webDir = next();
    else if (arg === "--database-url") config.databaseUrl = next();
    else if (!arg.startsWith("-")) command = arg;
    else throw new Error(`Unknown option ${arg}`);
  }
  config.dataDir = resolve(config.dataDir);
  if (!defaultProfile().localState && !config.databaseUrl) throw new Error("The cloud server needs DATABASE_URL (a Postgres server, e.g. Neon).");
  if (config.webDir) config.webDir = resolve(config.webDir);
  return { command, config };
}

export interface DataPaths {
  root: string;
  /** The bundled database's folder (home server). */
  db: string;
  /** The secret key's file (home server; the cloud server uses STRATA_SECRET_KEY). */
  secretKey: string;
  backups: string;
  transcode: string;
  logs: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const paths: DataPaths = {
    root: dataDir,
    db: join(dataDir, "db"),
    secretKey: join(dataDir, "secret.key"),
    backups: join(dataDir, "backups"),
    transcode: join(dataDir, "cache", "transcode"),
    logs: join(dataDir, "logs"),
  };
  // Workers have no disk: paths are only names there (nothing uses them).
  if (runtime.name === "bun") {
    for (const dir of [paths.root, paths.backups, paths.transcode, paths.logs]) mkdirSync(dir, { recursive: true });
  }
  return paths;
}
