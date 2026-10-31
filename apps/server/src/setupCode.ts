import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./db";
import { rowsOf } from "./db";
import { createHash } from "node:crypto";
import { sameSecret } from "./secrets";
import { logger } from "./log";

const log = logger("setup");
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * First-run setup makes whoever completes it the admin, so on a server reachable from
 * the internet it needs a code only the owner can see: printed in the server's log at
 * start while no account exists (a new one each start; only its hash is kept, shared
 * by every server on the database). The dashboard opened on the server's own machine
 * doesn't need it.
 */
export async function announceSetupCode(db: Db): Promise<void> {
  const code = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  await db.execute(sql`INSERT INTO strata_meta (key, value) VALUES ('setup_code', ${hashToken(code)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const pretty = code.match(/.{4}/g)!.join("-");
  log.info(`No account yet. To set up this server, open its dashboard and enter the setup code ${pretty}`);
}

export async function checkSetupCode(db: Db, code: string): Promise<boolean> {
  const rows = rowsOf<{ value: string }>(await db.execute(sql`SELECT value FROM strata_meta WHERE key = 'setup_code'`));
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return !!rows[0] && normalized.length === 12 && sameSecret(rows[0].value, hashToken(normalized));
}

export async function clearSetupCode(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM strata_meta WHERE key = 'setup_code'`);
}
