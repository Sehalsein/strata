import { and, eq, isNull, lt, or, count } from "drizzle-orm";
import type { Db } from "../../db";
import { torboxAdded } from "../../db/schema";
import type { Library } from "../../library";
import { logger } from "../../log";
import { TorboxError, type TorboxClient } from "./client";

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
    private readonly organizationId: string,
    private readonly library: Library,
    private readonly now: () => number = Date.now,
  ) {}

  private mine() {
    return eq(torboxAdded.organizationId, this.organizationId);
  }

  async recordAdded(torrentId: number, hash: string, name?: string) {
    await this.db.insert(torboxAdded).values({ organizationId: this.organizationId, torrentId, hash: hash.toLowerCase(), name: name ?? null, addedAt: this.now() }).onConflictDoNothing();
  }

  async recordPlayed(torrentId: number) {
    await this.db.update(torboxAdded).set({ lastPlayedAt: this.now() }).where(and(this.mine(), eq(torboxAdded.torrentId, torrentId)));
  }

  /** Torrents Strata added and nobody has played for `days` days. */
  stale(days: number) {
    const cutoff = this.now() - days * DAY;
    return this.db
      .select()
      .from(torboxAdded)
      .where(and(this.mine(), lt(torboxAdded.addedAt, cutoff), or(isNull(torboxAdded.lastPlayedAt), lt(torboxAdded.lastPlayedAt, cutoff))));
  }

  async count() {
    return (await this.db.select({ n: count() }).from(torboxAdded).where(this.mine()))[0]?.n ?? 0;
  }

  /**
   * Removes stale releases. `inUse` is asked right before each removal (not once up
   * front), so something that starts streaming mid-run is kept.
   */
  async clean(client: TorboxClient, days: number, inUse: (torrentId: number) => boolean | Promise<boolean>) {
    if (days <= 0) return { removed: 0, skipped: "cleanup is off" };
    let removed = 0;
    for (const candidate of await this.stale(days)) {
      // Re-read: a play recorded since the list was made keeps it.
      const row = (await this.stale(days)).find((r) => r.torrentId === candidate.torrentId);
      if (!row || (await inUse(row.torrentId))) continue;
      // Confirm the id is still the torrent we added (same hash) before deleting anything.
      let remote: { hash?: string } | null;
      try {
        remote = await client.torrent(row.torrentId);
      } catch (err) {
        if (err instanceof TorboxError && err.status === 404) remote = null;
        else {
          log.warn(`Couldn't check TorBox #${row.torrentId}`, err);
          continue;
        }
      }
      if (remote?.hash?.toLowerCase() === row.hash) {
        try {
          await client.deleteTorrent(row.torrentId);
        } catch (err) {
          if (!(err instanceof TorboxError && err.status === 404)) {
            log.warn(`Couldn't remove TorBox #${row.torrentId}`, err);
            continue;
          }
        }
        await this.library.markMissing("torbox", [], `torrents:${row.torrentId}:`);
        removed++;
        log.info(`Removed ${row.name ?? row.hash} from TorBox (#${row.torrentId}), unplayed for ${days}+ days`);
      } else {
        // Gone, or the id now belongs to something else (e.g. another account's key): forget it.
        log.info(`Forgetting TorBox #${row.torrentId}: no longer the release Strata added`);
      }
      await this.db.delete(torboxAdded).where(and(this.mine(), eq(torboxAdded.torrentId, row.torrentId)));
    }
    return { removed };
  }
}
