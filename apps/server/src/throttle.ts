import { eq, lt, or, and, isNull } from "drizzle-orm";
import type { Db } from "./db";
import { authAttempts } from "./db/schema";

export interface ThrottleRule {
  /** Failures allowed within `windowMs` before the key is locked. */
  limit: number;
  windowMs: number;
  /** How long a key stays locked once over the limit. */
  lockMs: number;
}

const MINUTE = 60_000;

/** Wrong passwords for one account from one address: the usual brute-force lock. */
export const LOGIN_PER_USER_ADDRESS: ThrottleRule = { limit: 10, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
/**
 * Wrong passwords for one account from anywhere (guessing spread over many addresses).
 * Higher, so a stranger guessing from one place locks out themselves, not the owner.
 */
export const LOGIN_PER_USER: ThrottleRule = { limit: 50, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
/** Wrong passwords from one address, whatever the account (spraying many accounts). */
export const LOGIN_PER_ADDRESS: ThrottleRule = { limit: 30, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
/** Wrong profile PINs from one signed-in device. */
export const PIN_PER_SESSION: ThrottleRule = { limit: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
/** Password-less joins and TV codes started from one address (counted on every try). */
export const STARTS_PER_ADDRESS: ThrottleRule = { limit: 10, windowMs: 10 * MINUTE, lockMs: 10 * MINUTE };
/** Wrong setup codes from one address. */
export const SETUP_PER_ADDRESS: ThrottleRule = { limit: 10, windowMs: 15 * MINUTE, lockMs: 60 * MINUTE };
/**
 * Release searches by one household (the server's stream addon is shared by all): plenty
 * for browsing, not for scraping.
 */
export const SEARCHES_PER_HOUSEHOLD: ThrottleRule = { limit: 300, windowMs: 60 * MINUTE, lockMs: 30 * MINUTE };
/** Releases one household's discovery adds to its TorBox in a day. */
export const ADDS_PER_HOUSEHOLD: ThrottleRule = { limit: 60, windowMs: 24 * 60 * MINUTE, lockMs: 60 * MINUTE };

/** Over a usage limit: answered as 429 with when to try again. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/**
 * Counts failed attempts per key in the database, so every server sharing it sees the
 * same counts and a restart doesn't reset them.
 */
export class Throttle {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until `key` may try again; 0 when it may now. */
  async retryAfter(key: string): Promise<number> {
    const [row] = await this.db.select().from(authAttempts).where(eq(authAttempts.key, key));
    const wait = (row?.lockedUntil ?? 0) - this.now();
    return wait > 0 ? wait : 0;
  }

  /** Records a failure. Returns the lock's remaining time if this one locked the key. */
  async fail(key: string, rule: ThrottleRule): Promise<number> {
    const now = this.now();
    const [row] = await this.db.select().from(authAttempts).where(eq(authAttempts.key, key));
    const fresh = !row || now - row.windowStart > rule.windowMs;
    const failures = fresh ? 1 : row.failures + 1;
    const lockedUntil = failures >= rule.limit ? now + rule.lockMs : (row?.lockedUntil ?? null);
    const values = { key, failures: failures >= rule.limit ? 0 : failures, windowStart: fresh || failures >= rule.limit ? now : row!.windowStart, lockedUntil };
    await this.db.insert(authAttempts).values(values).onConflictDoUpdate({ target: authAttempts.key, set: values });
    return lockedUntil && lockedUntil > now ? lockedUntil - now : 0;
  }

  /**
   * Counts one use of something limited (not a failure): throws RateLimitError when `key`
   * is over its limit, saying what was limited.
   */
  async spend(key: string, rule: ThrottleRule, what: string): Promise<void> {
    const wait = await this.retryAfter(key);
    if (wait) throw new RateLimitError(`${what} Try again in ${minutesText(wait)}.`, wait);
    await this.fail(key, rule);
  }

  /** Forgets `key`'s failures (a successful attempt). */
  async reset(key: string) {
    await this.db.delete(authAttempts).where(eq(authAttempts.key, key));
  }

  /** Drops rows whose window and lock have both passed. */
  async prune(maxAge = 24 * 60 * MINUTE) {
    const cutoff = this.now() - maxAge;
    await this.db.delete(authAttempts).where(and(lt(authAttempts.windowStart, cutoff), or(isNull(authAttempts.lockedUntil), lt(authAttempts.lockedUntil, this.now()))));
  }
}

/** "12 minutes", "1 minute". */
function minutesText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** "Try again in 12 minutes." */
export function retryMessage(ms: number): string {
  return `Too many attempts. Try again in ${minutesText(ms)}.`;
}
