import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { logger } from "../log";

const log = logger("timing");

/** API requests slower than this are logged, with where the time went. */
const SLOW_MS = 1000;

/** Time a request spent waiting on outside services, by service ("tmdb", "addon"…). */
interface RequestTimes {
  calls: Map<string, { count: number; ms: number }>;
}

const current = new AsyncLocalStorage<RequestTimes>();

/**
 * Times a call to an outside service against the request it's for (if any). Calls made
 * outside a request, or that a cache answered without calling, aren't counted.
 */
export async function timed<T>(service: string, run: () => Promise<T>): Promise<T> {
  const times = current.getStore();
  if (!times) return run();
  const started = performance.now();
  try {
    return await run();
  } finally {
    const entry = times.calls.get(service) ?? { count: 0, ms: 0 };
    entry.count++;
    entry.ms += performance.now() - started;
    times.calls.set(service, entry);
  }
}

/**
 * Says how long each API request took in a `Server-Timing` header (the total, and the
 * time spent on outside services), and logs the slow ones, so it's clear where time goes.
 */
export function requestTiming(): MiddlewareHandler {
  return async (c, next) => {
    const times: RequestTimes = { calls: new Map() };
    const started = performance.now();
    await current.run(times, next);
    const total = performance.now() - started;
    const parts = [...times.calls].map(([name, t]) => `${name};dur=${t.ms.toFixed(0)};desc="${t.count} calls"`);
    // JSON answers only: media and file responses go out exactly as they were made (see serveRange).
    if (c.res.headers.get("Content-Type")?.includes("application/json")) c.header("Server-Timing", [`total;dur=${total.toFixed(0)}`, ...parts].join(", "));
    if (total >= SLOW_MS) {
      const outside = [...times.calls].map(([name, t]) => `${name} ${t.count}× ${t.ms.toFixed(0)}ms`).join(", ");
      // The route's pattern, not the path: paths can carry tokens.
      log.info(`Slow: ${c.req.method} ${routePath(c, -1)} ${total.toFixed(0)}ms${outside ? ` (${outside})` : ""}`);
    }
  };
}
