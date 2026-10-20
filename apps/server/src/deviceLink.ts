import { randomBytes, randomInt } from "node:crypto";

/**
 * Sign-in by code for TVs: the TV starts a link and shows its short code (as a QR
 * code and as text), someone approves that code from a signed-in phone, and the
 * TV's next poll picks up a session of its own. The TV proves it started the link
 * with a secret poll token that never leaves it.
 */

const TTL_MS = 10 * 60_000;
/** Pending links are unauthenticated, so cap how many can exist at once. */
const MAX_PENDING = 50;
/** No 0/O, 1/I/L: the code is read off a TV and may be typed on a phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

interface Link {
  code: string;
  pollToken: string;
  deviceName: string;
  expiresAt: number;
  /** Set on approval; handed to the TV once, then the link is gone. */
  token?: string;
}

export type PollResult = { status: "pending" } | { status: "expired" } | { status: "approved"; token: string };

export class DeviceLinks {
  private readonly byPoll = new Map<string, Link>();
  private readonly byCode = new Map<string, Link>();

  constructor(private readonly now: () => number = Date.now) {}

  start(deviceName: string): { code: string; pollToken: string; expiresAt: number } | null {
    this.prune();
    if (this.byPoll.size >= MAX_PENDING) return null;
    let code = newCode();
    while (this.byCode.has(code)) code = newCode();
    const link: Link = { code, pollToken: randomBytes(32).toString("base64url"), deviceName, expiresAt: this.now() + TTL_MS };
    this.byPoll.set(link.pollToken, link);
    this.byCode.set(code, link);
    return { code, pollToken: link.pollToken, expiresAt: link.expiresAt };
  }

  /** The pending link for a code, for the approving phone to show what it's signing in. */
  pending(code: string): { deviceName: string; expiresAt: number } | null {
    const link = this.live(this.byCode.get(normalizeCode(code)));
    return link && !link.token ? { deviceName: link.deviceName, expiresAt: link.expiresAt } : null;
  }

  /** Approves a code with a session token minted for the approver. False if unknown, used or expired. */
  approve(code: string, issueToken: (deviceName: string) => string): boolean {
    const link = this.live(this.byCode.get(normalizeCode(code)));
    if (!link || link.token) return false;
    link.token = issueToken(link.deviceName);
    return true;
  }

  poll(pollToken: string): PollResult {
    const link = this.live(this.byPoll.get(pollToken));
    if (!link) return { status: "expired" };
    if (!link.token) return { status: "pending" };
    this.remove(link);
    return { status: "approved", token: link.token };
  }

  private live(link: Link | undefined): Link | undefined {
    if (!link) return undefined;
    if (link.expiresAt <= this.now()) {
      this.remove(link);
      return undefined;
    }
    return link;
  }

  private remove(link: Link) {
    this.byPoll.delete(link.pollToken);
    this.byCode.delete(link.code);
  }

  private prune() {
    for (const link of [...this.byPoll.values()]) this.live(link);
  }
}

function newCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Accepts "k7qf-2mxd", "K7QF 2MXD" and so on. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
