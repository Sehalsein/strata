// The server on Cloudflare Workers (the cloud server). See types.ts and src/worker.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import { argon2id, argon2Verify } from "hash-wasm";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import anitomyModule from "../vendor/anitomy/anitomy_ng_bg.wasm";
import type { DbClient, Runtime } from "./types";

/**
 * One request's database connection. Workers can't use a connection opened by another
 * request, so each request (or cron run) opens its own, straight to Neon over a
 * WebSocket (Neon's serverless driver; transactions work). src/worker.ts sets the
 * scope up and closes the connection when the request is done.
 */
export interface RequestScope {
  connectionString: string;
  pool?: Pool;
  db?: DbClient["db"];
  /** Work started for after the response; the request stays open (and connected) until it's done. */
  background?: Promise<unknown>[];
}

/** Waits for the scope's background work, including any it starts in turn. */
export async function drainScope(scope: RequestScope) {
  while (scope.background?.length) {
    const batch = scope.background.splice(0);
    await Promise.allSettled(batch);
  }
}

export const requestScope = new AsyncLocalStorage<RequestScope>();

/** Closes the scope's connection, if it opened one. */
export async function closeScope(scope: RequestScope) {
  await scope.pool?.end().catch(() => {});
}

function currentDb(): DbClient["db"] {
  const scope = requestScope.getStore();
  if (!scope) throw new Error("No database outside a request");
  if (!scope.db) {
    // One connection per request is plenty (a request's queries run one after another).
    scope.pool = new Pool({ connectionString: scope.connectionString, max: 1 });
    scope.db = drizzle({ client: scope.pool }) as unknown as DbClient["db"];
  }
  return scope.db;
}

/** Stands in for the database everywhere; every use goes to the current request's connection. */
const db = new Proxy({} as DbClient["db"], {
  get(_, prop) {
    const real = currentDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export const runtime: Runtime = {
  name: "workers",
  background: (task) => {
    const scope = requestScope.getStore();
    const settled = task.catch(() => {});
    if (scope) (scope.background ??= []).push(settled);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // OWASP's Argon2id minimum (19 MiB, 2 passes): within a Worker's memory and CPU.
  hashPassword: (password) =>
    argon2id({ password, salt: crypto.getRandomValues(new Uint8Array(16)), parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32, outputType: "encoded" }),
  verifyPassword: (password, hash) => argon2Verify({ password, hash }),
  anitomyWasm: () => anitomyModule as unknown as WebAssembly.Module,
  openClient: async () => ({ db, kind: "server", close: async () => {} }),
};
