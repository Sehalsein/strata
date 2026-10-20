import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { migrations } from "./migrations";
import { logger } from "../log";

const log = logger("db");
const BACKUPS_KEPT = 5;

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function openDatabase(path: string, backupsDir?: string): Db {
  const fresh = !existsSync(path);
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  migrate(sqlite, path, fresh ? undefined : backupsDir);
  return drizzle(sqlite, { schema }) as Db;
}

function migrate(sqlite: Database, path: string, backupsDir?: string) {
  const current = (sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current > migrations.length) {
    throw new Error(
      `Database schema v${current} is newer than this build supports (v${migrations.length}). Update Strata.`,
    );
  }
  if (current === migrations.length) return;

  if (backupsDir) backup(sqlite, path, backupsDir, current);

  for (let v = current; v < migrations.length; v++) {
    sqlite.transaction(() => {
      sqlite.exec(migrations[v]!);
      sqlite.exec(`PRAGMA user_version = ${v + 1}`);
    })();
    log.info(`Migrated database to v${v + 1}`);
  }
}

function backup(sqlite: Database, path: string, dir: string, version: number) {
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `strata-v${version}-${stamp}.db`);
  copyFileSync(path, target);
  log.info(`Backed up database to ${target}`);
  const old = readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
  for (const name of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) {
    rmSync(join(dir, name));
  }
}
