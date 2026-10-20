import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { profiles, sessions, users } from "./db/schema";

export interface AuthedSession {
  tokenHash: string;
  user: { id: number; username: string; isAdmin: boolean };
  profileId: number | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
let dummyHash: string | undefined;

export class Auth {
  constructor(private readonly db: Db) {}

  hasAnyUser(): boolean {
    return this.db.select({ id: users.id }).from(users).limit(1).get() !== undefined;
  }

  async createUser(username: string, password: string, isAdmin: boolean) {
    const passwordHash = await Bun.password.hash(password);
    return this.db.insert(users).values({ username, passwordHash, isAdmin }).returning({ id: users.id }).get();
  }

  async login(username: string, password: string, deviceName?: string): Promise<string | null> {
    const user = this.db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      // Spend comparable time so usernames can't be probed by timing.
      dummyHash ??= await Bun.password.hash("strata-dummy");
      await Bun.password.verify(password, dummyHash);
      return null;
    }
    if (!(await Bun.password.verify(password, user.passwordHash))) return null;
    return this.issue(user.id, deviceName);
  }

  issue(userId: number, deviceName?: string): string {
    const token = randomBytes(32).toString("base64url");
    // A single-profile household skips the picker.
    const allProfiles = this.db.select({ id: profiles.id, pin: profiles.pinHash }).from(profiles).all();
    const autoProfile = allProfiles.length === 1 && !allProfiles[0]!.pin ? allProfiles[0]!.id : null;
    this.db.insert(sessions).values({ tokenHash: hashToken(token), userId, deviceName, profileId: autoProfile }).run();
    return token;
  }

  verify(token: string): AuthedSession | null {
    const tokenHash = hashToken(token);
    const row = this.db
      .select({
        tokenHash: sessions.tokenHash,
        profileId: sessions.profileId,
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        username: users.username,
        isAdmin: users.isAdmin,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();
    if (!row) return null;
    if (Date.now() - row.lastSeenAt > 60_000) {
      this.db.update(sessions).set({ lastSeenAt: sql`(unixepoch() * 1000)` }).where(eq(sessions.tokenHash, tokenHash)).run();
    }
    return { tokenHash, profileId: row.profileId, user: { id: row.id, username: row.username, isAdmin: row.isAdmin } };
  }

  logout(tokenHash: string) {
    this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
  }

  async selectProfile(tokenHash: string, profileId: number, pin?: string): Promise<boolean> {
    const profile = this.db.select().from(profiles).where(eq(profiles.id, profileId)).get();
    if (!profile) return false;
    if (profile.pinHash && !(pin && (await Bun.password.verify(pin, profile.pinHash)))) return false;
    this.db.update(sessions).set({ profileId }).where(and(eq(sessions.tokenHash, tokenHash))).run();
    return true;
  }
}
