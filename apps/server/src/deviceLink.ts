import { randomBytes, randomInt } from "node:crypto";
import { and, count, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./db";
import { deviceLinks } from "./db/schema";
import { hashToken } from "./auth";
import type { SecretBox } from "./secrets";

/**
 * Sign-in by code for TVs: the TV starts a link and shows its short code (as a QR
 * code and as text), someone approves that code from a signed-in phone, and the
 * TV's next poll picks up a session of its own. The TV proves it started the link
 * with a secret poll token that never leaves it (only its hash is stored).
 *
 * Links live in the database, so a restart or another server behind the same address
 * doesn't lose one; the approved session's token waits there sealed until the TV polls.
 */

const TTL_MS = 10 * 60_000;
/** Pending links are unauthenticated, so cap how many can exist at once. */
const MAX_PENDING = 50;
/** A TV polls every couple of seconds; a link nobody polls is abandoned (or a flood). */
const ABANDONED_MS = 60_000;
/** No 0/O, 1/I/L: the code is read off a TV and may be typed on a phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SEAL_CONTEXT = "device-link";

export type PollResult = { status: "pending" } | { status: "expired" } | { status: "approved"; token: string };

type Row = typeof deviceLinks.$inferSelect;

export class DeviceLinks {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly now: () => number = Date.now,
  ) {}

  async start(deviceName: string): Promise<{ code: string; pollToken: string; expiresAt: number } | null> {
    await this.prune();
    const [{ n }] = (await this.db.select({ n: count() }).from(deviceLinks).where(isNull(deviceLinks.sealedToken))) as [{ n: number }];
    if (n >= MAX_PENDING) {
      // Full: make room by dropping the least recently polled link, so a flood of
      // starts can't lock out a TV that is actually waiting.
      const [stalest] = await this.db.select().from(deviceLinks).where(isNull(deviceLinks.sealedToken)).orderBy(deviceLinks.lastSeenAt).limit(1);
      if (!stalest) return null;
      await this.remove(stalest);
    }
    const now = this.now();
    const pollToken = randomBytes(32).toString("base64url");
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const inserted = await this.db
        .insert(deviceLinks)
        .values({ code, pollHash: hashToken(pollToken), deviceName, expiresAt: now + TTL_MS, lastSeenAt: now })
        .onConflictDoNothing()
        .returning({ code: deviceLinks.code });
      if (inserted.length) return { code, pollToken, expiresAt: now + TTL_MS };
    }
    return null;
  }

  /** The pending link for a code, for the approving phone to show what it's signing in. */
  async pending(code: string): Promise<{ deviceName: string; expiresAt: number } | null> {
    const link = await this.live(await this.byCode(code));
    return link && !link.sealedToken ? { deviceName: link.deviceName, expiresAt: link.expiresAt } : null;
  }

  /** Approves a code with a session token minted for the approver. False if unknown, used or expired. */
  async approve(code: string, issueToken: (deviceName: string) => Promise<string>): Promise<boolean> {
    const link = await this.live(await this.byCode(code));
    if (!link || link.sealedToken) return false;
    const sealed = this.box.seal(await issueToken(link.deviceName), SEAL_CONTEXT);
    // Only if still unapproved: two approvals at once mint one sign-in, not two.
    const updated = await this.db
      .update(deviceLinks)
      .set({ sealedToken: sealed })
      .where(and(eq(deviceLinks.code, link.code), isNull(deviceLinks.sealedToken)))
      .returning({ code: deviceLinks.code });
    return updated.length > 0;
  }

  async poll(pollToken: string): Promise<PollResult> {
    const [row] = await this.db.select().from(deviceLinks).where(eq(deviceLinks.pollHash, hashToken(pollToken)));
    const link = await this.live(row);
    if (!link) return { status: "expired" };
    if (!link.sealedToken) {
      await this.db.update(deviceLinks).set({ lastSeenAt: this.now() }).where(eq(deviceLinks.code, link.code));
      return { status: "pending" };
    }
    // Handed over once: whoever deletes the row gets the token.
    const taken = await this.db.delete(deviceLinks).where(eq(deviceLinks.code, link.code)).returning({ sealedToken: deviceLinks.sealedToken });
    if (!taken.length || !taken[0]!.sealedToken) return { status: "expired" };
    return { status: "approved", token: this.box.open(taken[0]!.sealedToken, SEAL_CONTEXT) };
  }

  private async byCode(code: string): Promise<Row | undefined> {
    return (await this.db.select().from(deviceLinks).where(eq(deviceLinks.code, normalizeCode(code))))[0];
  }

  private async live(link: Row | undefined): Promise<Row | undefined> {
    if (!link) return undefined;
    const now = this.now();
    if (link.expiresAt <= now || (!link.sealedToken && now - link.lastSeenAt > ABANDONED_MS)) {
      await this.remove(link);
      return undefined;
    }
    return link;
  }

  private async remove(link: Row) {
    await this.db.delete(deviceLinks).where(eq(deviceLinks.code, link.code));
  }

  private async prune() {
    const now = this.now();
    await this.db.delete(deviceLinks).where(or(lt(deviceLinks.expiresAt, now), and(isNull(deviceLinks.sealedToken), lt(deviceLinks.lastSeenAt, now - ABANDONED_MS))));
  }
}

function newCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Accepts "k7qf-2mxd", "K7QF 2MXD" and so on. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
