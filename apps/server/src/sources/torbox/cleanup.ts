import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { torboxAdded } from "../../db/schema";
import type { Library } from "../../library";
import { logger } from "../../log";
import type { TorboxClient } from "./client";

const log = logger("torbox");
const DAY = 24 * 60 * 60_000;

/**
 * Keeps the TorBox account from filling up with releases Strata added while
 * finding something to play. Only torrents recorded here (added by discovery) are
 * ever removed; anything added in TorBox itself is left alone.
 */
export class TorboxHousekeeping {
  constructor(
    private readonly db: Db,
    private readonly library: Library,
    private readonly now: () => number = Date.now,
  ) {}

  recordAdded(torrentId: number, hash: string, name?: string) {
    this.db.insert(torboxAdded).values({ torrentId, hash: hash.toLowerCase(), name: name ?? null, addedAt: this.now() }).onConflictDoNothing().run();
  }

  recordPlayed(torrentId: number) {
    this.db.update(torboxAdded).set({ lastPlayedAt: this.now() }).where(eq(torboxAdded.torrentId, torrentId)).run();
  }

  /** Torrents Strata added and nobody has played for `days` days. */
  stale(days: number) {
    const cutoff = this.now() - days * DAY;
    return this.db
      .select()
      .from(torboxAdded)
      .where(and(lt(torboxAdded.addedAt, cutoff), or(isNull(torboxAdded.lastPlayedAt), lt(torboxAdded.lastPlayedAt, cutoff))))
      .all();
  }

  count() {
    return this.db.select({ n: sql<number>`count(*)` }).from(torboxAdded).get()?.n ?? 0;
  }

  /** Removes stale releases. `inUse` skips torrents something is streaming right now. */
  async clean(client: TorboxClient, days: number, inUse: (torrentId: number) => boolean) {
    if (days <= 0) return { removed: 0, skipped: "cleanup is off" };
    let removed = 0;
    for (const row of this.stale(days)) {
      if (inUse(row.torrentId)) continue;
      try {
        await client.deleteTorrent(row.torrentId);
      } catch (err) {
        // Already gone from TorBox (deleted there by hand) is fine; anything else, try next time.
        if (!String(err).includes("404")) {
          log.warn(`Couldn't remove TorBox #${row.torrentId}`, err);
          continue;
        }
      }
      this.db.delete(torboxAdded).where(eq(torboxAdded.torrentId, row.torrentId)).run();
      this.library.markMissing("torbox", [], `torrents:${row.torrentId}:`);
      removed++;
      log.info(`Removed ${row.name ?? row.hash} from TorBox (#${row.torrentId}), unplayed for ${days}+ days`);
    }
    return { removed };
  }
}
