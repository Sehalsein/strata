import { eq, lt } from "drizzle-orm";
import type { Db } from "../db";
import { apiCache } from "../db/schema";
import { logger } from "../log";
import { SharedWork } from "../inFlight";
import { runtime } from "#runtime";

const log = logger("cache");

export interface CacheOptions {
  /** Answers younger than this are used as they are. */
  ttl: number;
  /**
   * Older answers, up to this age, are used at once while a fresh one is fetched behind
   * them, so a page never waits on a service for data it already has. Default 30 days.
   */
  maxStale?: number;
  /** How long a "doesn't exist" answer (see `missing`) is remembered. Default: not at all. */
  missingTtl?: number;
  /** Whether an error means "doesn't exist" (TMDB's 404), worth remembering. */
  missing?: (err: unknown) => boolean;
  /** After a failed fetch, the same key isn't tried again for this long. Default 60 s. */
  backoff?: number;
}

interface Entry {
  fetchedAt: number;
  value: unknown;
}

/** What's stored for a lookup that found nothing. */
interface Missing {
  __missing: true;
  message: string;
}

const MEMO_ENTRIES = 600;
const DAY = 24 * 60 * 60_000;

/**
 * Every outside service's answers (TMDB, OMDb, AniList, Kitsu…), kept in the database
 * (`api_cache`), so they survive restarts and are shared by every server on the same
 * database, with the most used held in memory. Identical lookups in flight share one
 * request; stale answers are served at once and refreshed behind; failures back off;
 * "not found" can be remembered too.
 */
export class ApiCache {
  private memo = new Map<string, Entry>();
  /** Fetches under way, joined by anyone asking for the same key meanwhile. */
  private inflight = new SharedWork<string, unknown>();
  private failedAt = new Map<string, number>();

  constructor(private readonly db: Db) {}

  /** The answer for `key`: cached when fresh enough, else from `fetch` (stored as returned). */
  async get<T>(key: string, options: CacheOptions, fetch: () => Promise<T>): Promise<T> {
    const entry = await this.read(key);
    const age = entry ? Date.now() - entry.fetchedAt : Infinity;
    if (entry && isMissing(entry.value)) {
      if (age < (options.missingTtl ?? 0)) throw new CachedMissing(entry.value.message);
    } else if (entry && age < options.ttl) {
      return entry.value as T;
    } else if (entry && age < (options.maxStale ?? 30 * DAY)) {
      if (!this.inflight.running(key) && !this.backingOff(key, options)) {
        runtime.background(this.inflight.get(key, () => this.fetch(key, options, fetch))); // a failed refresh keeps the old copy
      }
      return entry.value as T;
    }
    if (!this.inflight.running(key) && this.backingOff(key, options)) throw new Error("The service didn't answer a moment ago; try again shortly.");
    return this.inflight.get(key, () => this.fetch(key, options, fetch)) as Promise<T>;
  }

  /** Reads a cached answer, if any (memory, then the database). */
  async read(key: string): Promise<Entry | null> {
    const hit = this.memo.get(key);
    if (hit) {
      this.memo.delete(key);
      this.memo.set(key, hit);
      return hit;
    }
    const [row] = await this.db.select().from(apiCache).where(eq(apiCache.key, key));
    if (!row) return null;
    return this.remember(key, { fetchedAt: row.fetchedAt, value: JSON.parse(row.json) });
  }

  /** Stores an answer. */
  async write(key: string, value: unknown): Promise<void> {
    const fetchedAt = Date.now();
    const json = JSON.stringify(value);
    this.remember(key, { fetchedAt, value });
    try {
      await this.db.insert(apiCache).values({ key, json, fetchedAt }).onConflictDoUpdate({ target: apiCache.key, set: { json, fetchedAt } });
    } catch (err) {
      log.warn(`Couldn't store ${key}`, err);
    }
  }

  /** Drops answers older than `maxAge`. Returns how many. */
  async prune(maxAge = 30 * DAY): Promise<number> {
    this.memo.clear();
    const gone = await this.db.delete(apiCache).where(lt(apiCache.fetchedAt, Date.now() - maxAge)).returning({ key: apiCache.key });
    return gone.length;
  }

  private async fetch<T>(key: string, options: CacheOptions, fetch: () => Promise<T>): Promise<T> {
    {
      try {
        const value = await fetch();
        this.failedAt.delete(key);
        await this.write(key, value);
        return value;
      } catch (err) {
        if (options.missing?.(err) && options.missingTtl) {
          await this.write(key, { __missing: true, message: (err as Error).message } satisfies Missing);
        } else {
          this.failedAt.delete(key);
          this.failedAt.set(key, Date.now());
          if (this.failedAt.size > 2_000) this.failedAt.delete(this.failedAt.keys().next().value!);
        }
        throw err;
      }
    }
  }

  private backingOff(key: string, options: CacheOptions): boolean {
    const at = this.failedAt.get(key);
    return at !== undefined && Date.now() - at < (options.backoff ?? 60_000);
  }

  private remember(key: string, entry: Entry): Entry {
    this.memo.delete(key);
    this.memo.set(key, entry);
    if (this.memo.size > MEMO_ENTRIES) this.memo.delete(this.memo.keys().next().value!);
    return entry;
  }
}

/** A remembered "doesn't exist" answer. */
export class CachedMissing extends Error {}

function isMissing(value: unknown): value is Missing {
  return typeof value === "object" && value !== null && (value as Missing).__missing === true;
}
