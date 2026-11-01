import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { continueHidden, progress, watchlist } from "./db/schema";
import { formatRef, targetRef, type TitleRef, type TitleTarget } from "./catalog/ref";

export type ProgressRow = typeof progress.$inferSelect;

/**
 * A title counts as watched once this fraction is played, or, for anything long
 * enough to have end credits, once under 3 minutes remain.
 */
const COMPLETE_RATIO = 0.92;
const COMPLETE_REMAINING_MS = 180_000;
const CREDITS_MIN_DURATION_MS = 20 * 60_000;

/** Worth resuming once a minute in, or 5% in for short titles (never under 5s). */
const RESUME_MIN_MS = 60_000;
const RESUME_MIN_RATIO = 0.05;
const RESUME_FLOOR_MS = 5_000;

export function isComplete(positionMs: number, durationMs: number): boolean {
  if (durationMs <= 0) return false;
  if (positionMs / durationMs >= COMPLETE_RATIO) return true;
  return durationMs >= CREDITS_MIN_DURATION_MS && durationMs - positionMs <= COMPLETE_REMAINING_MS;
}

export function isResumable(row: Pick<ProgressRow, "positionMs" | "durationMs" | "completed">): boolean {
  if (row.completed || row.positionMs <= RESUME_FLOOR_MS) return false;
  return row.positionMs >= RESUME_MIN_MS || (row.durationMs > 0 && row.positionMs >= row.durationMs * RESUME_MIN_RATIO);
}

/** A movie, or an episode of a show, at its source. */
export type ProgressKey = TitleTarget;

export class ProgressStore {
  constructor(private readonly db: Db) {}

  async record(userId: string, key: ProgressKey, positionMs: number, durationMs: number): Promise<ProgressRow> {
    const completed = isComplete(positionMs, durationMs);
    const values = {
      userId,
      mediaType: key.mediaType,
      source: key.source,
      titleId: key.titleId,
      season: key.season ?? 0,
      episode: key.episode ?? 0,
      positionMs: Math.max(0, Math.round(positionMs)),
      durationMs: Math.round(durationMs),
      completed,
      updatedAt: Date.now(),
    };
    const [row] = await this.db
      .insert(progress)
      .values(values)
      .onConflictDoUpdate({
        target: [progress.userId, progress.source, progress.mediaType, progress.titleId, progress.season, progress.episode],
        set: { positionMs: values.positionMs, durationMs: values.durationMs, completed, updatedAt: values.updatedAt },
      })
      .returning();
    return row!;
  }

  async setWatched(userId: string, key: ProgressKey, watched: boolean) {
    const where = this.where(userId, key);
    if (!watched) {
      await this.db.delete(progress).where(where);
      return;
    }
    const [existing] = await this.db.select().from(progress).where(where);
    await this.record(userId, key, existing?.durationMs ?? 1, existing?.durationMs ?? 1);
  }

  async get(userId: string, key: ProgressKey): Promise<ProgressRow | undefined> {
    return (await this.db.select().from(progress).where(this.where(userId, key)))[0];
  }

  /** Every episode of `show` this person has progress on. */
  forShow(userId: string, show: TitleRef): Promise<ProgressRow[]> {
    return this.db
      .select()
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.source, show.source), eq(progress.mediaType, "episode"), eq(progress.titleId, show.id)));
  }

  /** Partially watched items, most recent first. */
  /** Takes a title off Continue Watching and Next Up, keeping its progress. */
  async hideFromContinue(userId: string, ref: TitleRef) {
    const hiddenAt = Date.now();
    await this.db
      .insert(continueHidden)
      .values({ userId, source: ref.source, type: ref.type, titleId: ref.id, hiddenAt })
      .onConflictDoUpdate({ target: [continueHidden.userId, continueHidden.source, continueHidden.type, continueHidden.titleId], set: { hiddenAt } });
  }

  /** Whether a progress row was hidden (and not watched since). */
  async hiddenFilter(userId: string): Promise<(row: Pick<ProgressRow, "source" | "mediaType" | "titleId" | "updatedAt">) => boolean> {
    const hidden = new Map(
      (await this.db.select().from(continueHidden).where(eq(continueHidden.userId, userId))).map((h) => [formatRef({ source: h.source, type: h.type, id: h.titleId }), h.hiddenAt]),
    );
    return (row) => {
      const at = hidden.get(formatRef(targetRef(row)));
      return at !== undefined && row.updatedAt <= at;
    };
  }

  inProgress(userId: string, limit = 20): Promise<ProgressRow[]> {
    return this.db
      .select()
      .from(progress)
      .where(
        and(
          eq(progress.userId, userId),
          eq(progress.completed, false),
          // Same rule as isResumable().
          sql`${progress.positionMs} > ${RESUME_FLOOR_MS} AND (${progress.positionMs} >= ${RESUME_MIN_MS} OR ${progress.positionMs} >= ${progress.durationMs} * ${RESUME_MIN_RATIO}::double precision)`,
        ),
      )
      .orderBy(desc(progress.updatedAt))
      .limit(limit);
  }

  /** The most recently completed episode per show, for Next Up. */
  async recentlyCompletedEpisodes(userId: string, limit = 30): Promise<ProgressRow[]> {
    const rows = await this.db
      .select()
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.mediaType, "episode"), eq(progress.completed, true)))
      .orderBy(desc(progress.updatedAt))
      .limit(500);
    const latest = new Map<string, ProgressRow>();
    for (const row of rows) {
      const show = formatRef(targetRef(row));
      const current = latest.get(show);
      // The furthest episode wins, not the last one touched (rewatches of old episodes).
      if (!current || row.season > current.season || (row.season === current.season && row.episode > current.episode)) {
        latest.set(show, row);
      }
    }
    return [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  watchlist(userId: string) {
    return this.db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(desc(watchlist.addedAt));
  }

  async inWatchlist(userId: string, ref: TitleRef): Promise<boolean> {
    return (await this.db.select().from(watchlist).where(this.listed(userId, ref))).length > 0;
  }

  async setWatchlist(userId: string, ref: TitleRef, on: boolean) {
    if (on) await this.db.insert(watchlist).values({ userId, source: ref.source, type: ref.type, titleId: ref.id }).onConflictDoNothing();
    else await this.db.delete(watchlist).where(this.listed(userId, ref));
  }

  private listed(userId: string, ref: TitleRef) {
    return and(eq(watchlist.userId, userId), eq(watchlist.source, ref.source), eq(watchlist.type, ref.type), eq(watchlist.titleId, ref.id));
  }

  private where(userId: string, key: ProgressKey) {
    return and(
      eq(progress.userId, userId),
      eq(progress.source, key.source),
      eq(progress.mediaType, key.mediaType),
      eq(progress.titleId, key.titleId),
      eq(progress.season, key.season ?? 0),
      eq(progress.episode, key.episode ?? 0),
    );
  }
}
