import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { Db } from "./db";
import { profiles, sessions, users } from "./db/schema";
import { LOGIN_PER_ADDRESS, LOGIN_PER_USER, LOGIN_PER_USER_ADDRESS, PIN_PER_SESSION, retryMessage, type Throttle } from "./throttle";

export interface AuthedSession {
  tokenHash: string;
  user: { id: number; username: string; isAdmin: boolean };
  profileId: number | null;
}

const DAY = 24 * 60 * 60_000;
/** A device stays signed in this long after it was last used. */
export const SESSION_TTL_MS = 90 * DAY;
/** How often `lastSeenAt` (and the expiry with it) is written: not on every request. */
const TOUCH_EVERY_MS = 60_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
let dummyHash: string | undefined;

/** Why a sign-in failed: wrong details (401) or too many tries (429). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 429,
  ) {
    super(message);
  }
}

/**
 * Accounts, signed-in devices and profiles.
 * - Passwords and PINs: Argon2id (Bun.password), compared in constant time.
 * - Session tokens: 256 random bits; only their SHA-256 is stored. They last
 *   `SESSION_TTL_MS` past last use, and a password change signs out the account's other
 *   devices.
 * - Wrong passwords and PINs are throttled per account, per address and per device
 *   (in the database, so every server counts together).
 */
export class Auth {
  constructor(
    private readonly db: Db,
    private readonly throttle: Throttle,
    private readonly now: () => number = Date.now,
  ) {}

  /** The household account that password-less devices join as. */
  async householdUserId(): Promise<number | undefined> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).orderBy(users.id).limit(1);
    return row?.id;
  }

  async hasAnyUser(): Promise<boolean> {
    return (await this.db.select({ id: users.id }).from(users).limit(1)).length > 0;
  }

  async createUser(username: string, password: string, isAdmin: boolean) {
    const passwordHash = await Bun.password.hash(password);
    const [row] = await this.db.insert(users).values({ username, passwordHash, isAdmin }).returning({ id: users.id });
    return row!;
  }

  /** Creates the first admin, or returns null if any user already exists (safe against two at once). */
  async createFirstAdmin(username: string, password: string): Promise<{ id: number } | null> {
    const passwordHash = await Bun.password.hash(password);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(4831208)`);
      if ((await tx.select({ id: users.id }).from(users).limit(1)).length) return null;
      const [row] = await tx.insert(users).values({ username, passwordHash, isAdmin: true }).returning({ id: users.id });
      return row!;
    });
  }

  /** Signs in. Throws AuthError when the details are wrong or there were too many tries. */
  async login(username: string, password: string, address: string, deviceName?: string): Promise<string> {
    const name = username.toLowerCase();
    const keys = [
      [`login:user:${name}:${address}`, LOGIN_PER_USER_ADDRESS],
      [`login:user:${name}`, LOGIN_PER_USER],
      [`login:address:${address}`, LOGIN_PER_ADDRESS],
    ] as const;
    let wait = 0;
    for (const [key] of keys) wait = Math.max(wait, await this.throttle.retryAfter(key));
    if (wait) throw new AuthError(retryMessage(wait), 429);

    const [user] = await this.db.select().from(users).where(eq(users.username, username));
    // Spend comparable time when there's no such user, so usernames can't be probed by timing.
    const ok = user ? await Bun.password.verify(password, user.passwordHash) : await verifyDummy(password);
    if (!user || !ok) {
      let locked = 0;
      for (const [key, rule] of keys) locked = Math.max(locked, await this.throttle.fail(key, rule));
      throw new AuthError(locked ? retryMessage(locked) : "Wrong username or password", locked ? 429 : 401);
    }
    await this.throttle.reset(keys[0][0]);
    return this.issue(user.id, deviceName);
  }

  async issue(userId: number, deviceName?: string, options: { viewerOnly?: boolean } = {}): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    // A single-profile household skips the picker.
    const allProfiles = await this.db.select({ id: profiles.id, pin: profiles.pinHash }).from(profiles);
    const autoProfile = allProfiles.length === 1 && !allProfiles[0]!.pin ? allProfiles[0]!.id : null;
    const now = this.now();
    await this.db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      deviceName,
      profileId: autoProfile,
      viewerOnly: options.viewerOnly ?? false,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return token;
  }

  async verify(token: string): Promise<AuthedSession | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({
        tokenHash: sessions.tokenHash,
        profileId: sessions.profileId,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        id: users.id,
        username: users.username,
        isAdmin: users.isAdmin,
        viewerOnly: sessions.viewerOnly,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash));
    if (!row) return null;
    const now = this.now();
    if (row.expiresAt <= now) {
      await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      return null;
    }
    if (now - row.lastSeenAt > TOUCH_EVERY_MS) {
      await this.db.update(sessions).set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.tokenHash, tokenHash));
    }
    return { tokenHash, profileId: row.profileId, user: { id: row.id, username: row.username, isAdmin: row.isAdmin && !row.viewerOnly } };
  }

  /** Signed-in devices, newest activity first. `id` is the token hash (not the token). */
  devices() {
    return this.db
      .select({
        id: sessions.tokenHash,
        deviceName: sessions.deviceName,
        profileName: profiles.name,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        viewerOnly: sessions.viewerOnly,
      })
      .from(sessions)
      .leftJoin(profiles, eq(profiles.id, sessions.profileId))
      .where(gt(sessions.expiresAt, this.now()))
      .orderBy(desc(sessions.lastSeenAt));
  }

  async logout(tokenHash: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /**
   * Changes a password after checking the current one, and signs out every other device
   * of that account. Returns false when the current password is wrong.
   */
  async changePassword(userId: number, current: string, next: string, keepTokenHash: string): Promise<boolean> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await Bun.password.verify(current, user.passwordHash))) return false;
    await this.db.update(users).set({ passwordHash: await Bun.password.hash(next) }).where(eq(users.id, userId));
    await this.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepTokenHash)));
    return true;
  }

  /** Throws AuthError 403 on a wrong PIN, 429 after too many. */
  async selectProfile(tokenHash: string, profileId: number, pin?: string): Promise<boolean> {
    const [profile] = await this.db.select().from(profiles).where(eq(profiles.id, profileId));
    if (!profile) return false;
    if (profile.pinHash) {
      const key = `pin:${tokenHash}`;
      const wait = await this.throttle.retryAfter(key);
      if (wait) throw new AuthError(retryMessage(wait), 429);
      if (!(pin && (await Bun.password.verify(pin, profile.pinHash)))) {
        const locked = await this.throttle.fail(key, PIN_PER_SESSION);
        throw new AuthError(locked ? retryMessage(locked) : "Wrong PIN", locked ? 429 : 403);
      }
      await this.throttle.reset(key);
    }
    await this.db.update(sessions).set({ profileId }).where(eq(sessions.tokenHash, tokenHash));
    return true;
  }

  /** Signed in without a password (home join, TV code): there's no password to check. */
  async isViewerOnly(tokenHash: string): Promise<boolean> {
    const [row] = await this.db.select({ v: sessions.viewerOnly }).from(sessions).where(eq(sessions.tokenHash, tokenHash));
    return row?.v ?? true;
  }

  /** Removes expired sessions. */
  async prune() {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, this.now()));
  }
}

async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= await Bun.password.hash("strata-dummy");
  await Bun.password.verify(password, dummyHash);
  return false;
}

/** Constant-time comparison of two strings (setup codes). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
