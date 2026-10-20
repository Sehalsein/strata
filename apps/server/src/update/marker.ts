import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Boot-failure rollback. Before swapping binaries the updater writes `pending-update.json`.
 * Every boot of the new version bumps `attempts`; the marker is cleared once the server has
 * stayed up for a while. If the new version has already failed to boot MAX_FAILED_BOOTS
 * times, the next start restores `<binary>.old` and the pre-update DB backup.
 */

export const MAX_FAILED_BOOTS = 2;
export const HEALTHY_AFTER_MS = 30_000;

export interface PendingUpdate {
  fromVersion: string;
  toVersion: string;
  binaryPath: string;
  /** The previous binary, kept beside the new one. */
  backupBinaryPath: string;
  dbPath: string;
  /** Pre-update DB copy; null when there was no DB yet. */
  dbBackupPath: string | null;
  /** Boots of `toVersion` so far. */
  attempts: number;
  createdAt: string;
}

export interface LastUpdate {
  result: "ok" | "rolled-back";
  fromVersion: string;
  toVersion: string;
  at: string;
  message?: string;
}

export const markerPath = (dataDir: string) => join(dataDir, "pending-update.json");
export const lastUpdatePath = (dataDir: string) => join(dataDir, "last-update.json");

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Writes via a temp file + rename so a crash never leaves half a marker. */
function writeJson(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

export const readMarker = (dataDir: string) => readJson<PendingUpdate>(markerPath(dataDir));
export const writeMarker = (dataDir: string, marker: PendingUpdate) => writeJson(markerPath(dataDir), marker);
export const clearMarker = (dataDir: string) => rmSync(markerPath(dataDir), { force: true });
export const readLastUpdate = (dataDir: string) => readJson<LastUpdate>(lastUpdatePath(dataDir));
export const writeLastUpdate = (dataDir: string, value: LastUpdate) => writeJson(lastUpdatePath(dataDir), value);

export type BootDecision =
  | { action: "none" }
  /** A marker for a version that isn't running (the swap never happened, or it was undone). */
  | { action: "clear"; marker: PendingUpdate }
  | { action: "continue"; marker: PendingUpdate }
  | { action: "rollback"; marker: PendingUpdate };

/** Pure: what this boot should do about a pending update. */
export function decideBoot(marker: PendingUpdate | null, runningVersion: string): BootDecision {
  if (!marker) return { action: "none" };
  if (marker.toVersion !== runningVersion) return { action: "clear", marker };
  if (marker.attempts >= MAX_FAILED_BOOTS) return { action: "rollback", marker };
  return { action: "continue", marker: { ...marker, attempts: marker.attempts + 1 } };
}

/** Puts the previous binary and DB back. Runs before the DB is opened. */
export function rollback(dataDir: string, marker: PendingUpdate, reason: string) {
  if (existsSync(marker.backupBinaryPath)) renameSync(marker.backupBinaryPath, marker.binaryPath);
  else throw new Error(`Can't roll back: ${marker.backupBinaryPath} is missing`);
  if (marker.dbBackupPath && existsSync(marker.dbBackupPath)) {
    for (const suffix of ["-wal", "-shm"]) rmSync(marker.dbPath + suffix, { force: true });
    copyFileSync(marker.dbBackupPath, marker.dbPath);
  }
  writeLastUpdate(dataDir, { result: "rolled-back", fromVersion: marker.fromVersion, toVersion: marker.toVersion, at: new Date().toISOString(), message: reason });
  clearMarker(dataDir);
}

export type BootOutcome = "none" | "cleared" | "trial" | "rolled-back";

/**
 * Called first thing on `serve`. "rolled-back" means the old binary is back in place and
 * this process must restart into it without opening the database.
 */
export function bootCheck(dataDir: string, runningVersion: string): BootOutcome {
  const decision = decideBoot(readMarker(dataDir), runningVersion);
  switch (decision.action) {
    case "none":
      return "none";
    case "clear":
      clearMarker(dataDir);
      return "cleared";
    case "continue":
      writeMarker(dataDir, decision.marker);
      return "trial";
    case "rollback":
      rollback(dataDir, decision.marker, `v${decision.marker.toVersion} failed to start ${decision.marker.attempts} times`);
      return "rolled-back";
  }
}

/** The new version has been up long enough: the update stuck. */
export function markHealthy(dataDir: string, runningVersion: string): boolean {
  const marker = readMarker(dataDir);
  if (!marker || marker.toVersion !== runningVersion) return false;
  clearMarker(dataDir);
  writeLastUpdate(dataDir, { result: "ok", fromVersion: marker.fromVersion, toVersion: marker.toVersion, at: new Date().toISOString() });
  return true;
}
