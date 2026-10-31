// The server on Bun: the home server (Mac app, Linux binary, Docker) and the cloud
// container. See types.ts.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import wasmPath from "../vendor/anitomy/anitomy_ng_bg.wasm" with { type: "file" };
import { restorePathFor } from "../update/marker";
import type { DbClient, Runtime } from "./types";

export const runtime: Runtime = {
  name: "bun",
  sleep: (ms) => Bun.sleep(ms),
  hashPassword: (password) => Bun.password.hash(password, { algorithm: "argon2id" }),
  verifyPassword: (password, hash) => Bun.password.verify(password, hash),
  anitomyWasm: () => new WebAssembly.Module(readFileSync(wasmPath)),
  openClient: (target) => (/^postgres(ql)?:\/\//.test(target) ? openServer(target) : openBundled(target)),
};

async function openServer(url: string): Promise<DbClient> {
  const { drizzle } = await import("drizzle-orm/bun-sql");
  const client = new Bun.SQL(url, { max: 10, idleTimeout: 30 });
  return { db: drizzle({ client }) as unknown as DbClient["db"], kind: "server", close: () => client.close() };
}

/** PGlite: Postgres in this process, kept in `target` (a folder), or in memory for tests. */
async function openBundled(target: string): Promise<DbClient> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  // An update that was rolled back left the previous database as a snapshot to restore.
  const restore = target !== "memory" && existsSync(restorePathFor(target)) ? restorePathFor(target) : null;
  if (restore) rmSync(target, { recursive: true, force: true });
  if (target !== "memory") mkdirSync(target, { recursive: true });
  const client = await PGlite.create(target === "memory" ? undefined : target, {
    ...(await bundledAssets()),
    ...(restore ? { loadDataDir: Bun.file(restore) } : {}),
  });
  if (restore) rmSync(restore);
  return {
    db: drizzle({ client }) as unknown as DbClient["db"],
    kind: "bundled",
    close: () => client.close(),
    dump: async (path) => writeFileSync(path, Buffer.from(await (await client.dumpDataDir("gzip")).arrayBuffer())),
  };
}

/** PGlite's engine files, embedded in the compiled server (see bundledPglite.ts). */
async function bundledAssets() {
  try {
    const { pgliteAssets } = await import("../db/bundledPglite");
    return await pgliteAssets();
  } catch {
    return {}; // running from source: PGlite finds its files in node_modules
  }
}
