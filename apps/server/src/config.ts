import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface RuntimeConfig {
  dataDir: string;
  port: number;
  host: string;
  /** Directory of a built dashboard to serve from disk instead of the embedded copy (dev). */
  webDir?: string;
}

export function defaultDataDir(): string {
  if (process.env.STRATA_DATA_DIR) return process.env.STRATA_DATA_DIR;
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
    else if (!arg.startsWith("-")) command = arg;
    else throw new Error(`Unknown option ${arg}`);
  }
  config.dataDir = resolve(config.dataDir);
  if (config.webDir) config.webDir = resolve(config.webDir);
  return { command, config };
}

export interface DataPaths {
  root: string;
  db: string;
  secretKey: string;
  backups: string;
  transcode: string;
  logs: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const paths: DataPaths = {
    root: dataDir,
    db: join(dataDir, "strata.db"),
    secretKey: join(dataDir, "secret.key"),
    backups: join(dataDir, "backups"),
    transcode: join(dataDir, "cache", "transcode"),
    logs: join(dataDir, "logs"),
  };
  for (const dir of [paths.root, paths.backups, paths.transcode, paths.logs]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
