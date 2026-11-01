import { existsSync } from "node:fs";
import { backupDatabase, type Db } from "../db";
import type { ServerSettingsStore } from "../settings";
import { compiledBinaryPath } from "../platform/runtime";
import { UPDATE_BASE_URL, VERSION } from "../version";
import { currentPlatformKey } from "./manifest";
import { UPDATE_PUBLIC_KEY } from "./publicKey";
import { Updater, UpdateError, type UpdateStatus } from "./updater";

export { Updater, UpdateError, type UpdateStatus, type UpdateState } from "./updater";

/**
 * Updating the server, as the rest of it sees it. Two adapters: the compiled binary's
 * (`createUpdater`: checks the signed feed, downloads, swaps itself, restarts) and a
 * server that's updated by deploying it (`deployedUpdates`: says so from every call).
 * The dashboard reads `status().disabledReason`; nothing else asks how the server runs.
 */
export interface SelfUpdate {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  /** The scheduled check: applies a new version when automatic updates are on. */
  checkAndMaybeApply(): Promise<unknown>;
  /** Starts applying in the background; throws UpdateError when it can't. */
  startApply(): void;
  apply(opts?: { waitForIdle?: boolean }): Promise<void>;
  /** Called once the new version is in place, to stop the server and restart it. */
  onRestart(fn: () => void): void;
}

/** A server updated by deploying a new version (cloud): nothing to check or apply. */
export function deployedUpdates(reason: string, settings: () => { updateChannel?: string; autoUpdate?: boolean }): SelfUpdate {
  const status = (): UpdateStatus => ({
    currentVersion: VERSION,
    platform: currentPlatformKey(),
    channel: (settings().updateChannel ?? "stable") as UpdateStatus["channel"],
    autoUpdate: false,
    state: "idle",
    disabledReason: reason,
    manifestUrl: null,
    latest: null,
    updateAvailable: false,
    lastCheckedAt: null,
    lastError: null,
    progress: null,
    lastUpdate: null,
  });
  const refuse = () => {
    throw new UpdateError(reason, 409);
  };
  return {
    status,
    check: async () => status(),
    checkAndMaybeApply: async () => ({ skipped: reason }),
    startApply: refuse,
    apply: async () => refuse(),
    onRestart: () => {},
  };
}

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
