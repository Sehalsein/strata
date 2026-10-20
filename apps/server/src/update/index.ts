import { existsSync } from "node:fs";
import { backupDatabase, type Db } from "../db";
import type { SettingsStore } from "../settings";
import { compiledBinaryPath, inDocker } from "../platform/runtime";
import { UPDATE_BASE_URL, VERSION } from "../version";
import { currentPlatformKey } from "./manifest";
import { UPDATE_PUBLIC_KEY } from "./publicKey";
import { Updater } from "./updater";

export { Updater, UpdateError, type UpdateStatus, type UpdateState } from "./updater";

export function createUpdater(opts: {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  db: Db;
  settings: SettingsStore;
  activeSessions: () => number;
  fetch?: typeof fetch;
}): Updater {
  const binary = compiledBinaryPath();
  const docker = inDocker();
  // Replacing the binary inside Strata.app would break its signature.
  const inApp = !!binary && binary.includes(".app/Contents/MacOS/");
  return new Updater({
    version: VERSION,
    platform: currentPlatformKey(),
    dataDir: opts.dataDir,
    dbPath: opts.dbPath,
    binaryPath: docker || inApp ? null : binary,
    disabledReason: docker
      ? "Running in Docker: update by pulling a newer image"
      : inApp
        ? "Installed as Strata.app: update by installing the new version"
        : binary
        ? null
        : "Running from source: self-update only works in the compiled binary",
    publicKey: UPDATE_PUBLIC_KEY,
    feedBaseUrl: UPDATE_BASE_URL,
    settings: () => opts.settings.get(),
    activeSessions: opts.activeSessions,
    backupDb: () => (existsSync(opts.dbPath) ? backupDatabase(opts.db.$client, opts.dbPath, opts.backupsDir, `pre-update-v${VERSION}`) : null),
    fetch: opts.fetch,
  });
}
