import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./db";
import { rowsOf } from "./db";
import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "./log";
import { isCloud } from "./mode";

const log = logger("setup");
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * First-run setup makes whoever completes it the admin, so on a server reachable from
 * the internet it needs a code only the owner can see: printed in the server's log at
 * start while no account exists (a new one each start; only its hash is kept, shared
 * by every server on the database). The dashboard opened on the server's own machine
 * doesn't need it.
 *
 * In the cloud several instances can start together on one database (Workers start them
 * on demand): a code made in the last hour is kept, so the one in the log stays the one
 * that works, and only the instance that made it logs it.
 */
const CODE_LIFETIME_MS = isCloud ? 60 * 60 * 1000 : 0;

export async function announceSetupCode(db: Db): Promise<void> {
  const code = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const now = Date.now();
  const stored = rowsOf<{ value: string }>(
    await db.execute(sql`INSERT INTO strata_meta (key, value) VALUES ('setup_code', ${`${hashToken(code)}:${now}`})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      WHERE split_part(strata_meta.value, ':', 2) = '' OR split_part(strata_meta.value, ':', 2)::bigint <= ${now - CODE_LIFETIME_MS}
      RETURNING value`),
  );
  if (stored.length === 0) {
    log.info("No account yet. A setup code was logged in the last hour (by this or another instance); a new one comes an hour after it.");
    return;
  }
  const pretty = code.match(/.{4}/g)!.join("-");
  log.info(`No account yet. To set up this server, open its dashboard and enter the setup code ${pretty}`);
}

export async function checkSetupCode(db: Db, code: string): Promise<boolean> {
  const rows = rowsOf<{ value: string }>(await db.execute(sql`SELECT value FROM strata_meta WHERE key = 'setup_code'`));
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hash = rows[0]?.value.split(":")[0];
  return !!hash && normalized.length === 12 && safeEqual(hash, hashToken(normalized));
}

export async function clearSetupCode(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM strata_meta WHERE key = 'setup_code'`);
}
