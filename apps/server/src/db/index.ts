import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { migrations } from "./migrations";
import { logger } from "../log";
import { runtime } from "#runtime";

const log = logger("db");
const BACKUPS_KEPT = 5;

/**
 * Postgres, whichever way it's reached: bundled in-process (PGlite) on a home server, or a
 * server such as Neon from `DATABASE_URL`. Queries are the same either way.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

interface Handle {
  kind: "bundled" | "server";
  close: () => Promise<void>;
  /** Bundled only: writes a compressed copy of the whole database to `path`. */
  dump?: (path: string) => Promise<void>;
}

const handles = new WeakMap<object, Handle>();
const handleOf = (db: Db): Handle => handles.get(db)!;

/**
 * Opens the database and brings its schema up to date.
 * - `postgres://…` / `postgresql://…`: a Postgres server (Neon in the cloud);
 * - a directory: the bundled database, kept there (the home server's default);
 * - `memory`: bundled, in memory (tests).
 */
export async function openDatabase(target: string): Promise<Db> {
  const client = await runtime.openClient(target);
  const db = client.db as unknown as Db;
  handles.set(db, { kind: client.kind, close: client.close, dump: client.dump });
  if (client.kind === "server" && /^postgres/.test(target)) log.info(`Using Postgres at ${new URL(target).host}`);
  await migrate(db);
  return db;
}

export const closeDatabase = (db: Db) => handleOf(db).close();

/**
 * The schema version lives in `strata_meta`. Several servers may start at once (a cloud
 * deploy): an advisory lock lets one migrate while the others wait.
 */
async function migrate(db: Db) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4831207)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS strata_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const rows = rowsOf(await tx.execute(sql`SELECT value FROM strata_meta WHERE key = 'schema_version'`));
    const current = rows.length ? Number(rows[0]!.value) : 0;
    if (current > migrations.length) {
      throw new Error(`Database schema v${current} is newer than this build supports (v${migrations.length}). Update Strata.`);
    }
    if (current === migrations.length) return;
    for (let v = current; v < migrations.length; v++) {
      for (const statement of splitStatements(migrations[v]!)) await tx.execute(sql.raw(statement));
      log.info(`Migrated database to v${v + 1}`);
    }
    const version = String(migrations.length);
    await tx.execute(sql`INSERT INTO strata_meta (key, value) VALUES ('schema_version', ${version})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  });
}

/** Rows from `execute`, whichever driver: Bun.SQL and postgres.js return an array, PGlite `{ rows }`. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Migrations hold no semicolons inside strings, so splitting on them is safe. */
function splitStatements(script: string): string[] {
  return script.split(";").map((s) => s.trim()).filter(Boolean);
}

/**
 * Bundled database only (a Postgres server keeps its own backups, e.g. Neon's history):
 * writes a compressed copy into `dir`, keeping the newest few. Returns its path.
 */
export async function backupDatabase(db: Db, dir: string, label: string): Promise<string | null> {
  const dump = handleOf(db).dump;
  if (!dump) return null;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `strata-${label}-${stamp}.tar.gz`);
  await dump(target);
  log.info(`Backed up database to ${target}`);
  const old = readdirSync(dir)
    .filter((f) => f.endsWith(".tar.gz") || f.endsWith(".db"))
    .sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs);
  for (const name of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) rmSync(join(dir, name));
  return target;
}
