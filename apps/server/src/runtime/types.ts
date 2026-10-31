import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * What differs between where the server runs: Bun (the home server, the cloud
 * container) and Cloudflare Workers (the cloud server). `#runtime` resolves to one
 * implementation per build (package.json "imports": the `workerd` condition picks
 * workers.ts; everything else bun.ts).
 */
export interface Runtime {
  name: "bun" | "workers";
  sleep(ms: number): Promise<void>;
  /** Argon2id, PHC string ("$argon2id$v=19$m=…"): either runtime verifies the other's. */
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  /** The filename parser's WebAssembly module (synchronous: parsing is). */
  anitomyWasm(): WebAssembly.Module;
  /** A Postgres client for `target` (see db/index.ts). */
  openClient(target: string): Promise<DbClient>;
}

export interface DbClient {
  db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
  kind: "bundled" | "server";
  close(): Promise<void>;
  dump?(path: string): Promise<void>;
}
