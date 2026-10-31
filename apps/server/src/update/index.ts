import { existsSync } from "node:fs";
import { backupDatabase, type Db } from "../db";
import type { ServerSettingsStore } from "../settings";
import { compiledBinaryPath } from "../platform/runtime";
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
  settings: ServerSettingsStore;
  activeSessions: () => number;
  fetch?: typeof fetch;
}): Updater {
  const binary = compiledBinaryPath();
  // Replacing the binary inside Strata.app would break its signature.
  const inApp = !!binary && binary.includes(".app/Contents/MacOS/");
  return new Updater({
    version: VERSION,
    platform: currentPlatformKey(),
    dataDir: opts.dataDir,
    dbPath: opts.dbPath,
    binaryPath: inApp ? null : binary,
    disabledReason: inApp
      ? "Installed as Strata.app: update by installing the new version"
      : binary
        ? null
        : "Running from source: self-update only works in the compiled binary",
    publicKey: UPDATE_PUBLIC_KEY,
    feedBaseUrl: UPDATE_BASE_URL,
    settings: () => opts.settings.get(),
    activeSessions: opts.activeSessions,
    backupDb: () => backupDatabase(opts.db, opts.backupsDir, `pre-update-v${VERSION}`),
    fetch: opts.fetch,
  });
}
