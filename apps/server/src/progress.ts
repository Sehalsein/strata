import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { progress, watchlist } from "./db/schema";

export type ProgressRow = typeof progress.$inferSelect;

/** A title counts as watched once this fraction is played or under 3 minutes remain. */
const COMPLETE_RATIO = 0.92;
const COMPLETE_REMAINING_MS = 180_000;

export interface ProgressKey {
  mediaType: "movie" | "episode";
  tmdbId: number;
  season?: number;
  episode?: number;
}

export class ProgressStore {
  constructor(private readonly db: Db) {}

  record(profileId: number, key: ProgressKey, positionMs: number, durationMs: number): ProgressRow {
    const completed = durationMs > 0 && (positionMs / durationMs >= COMPLETE_RATIO || durationMs - positionMs <= COMPLETE_REMAINING_MS);
    const values = {
      profileId,
      mediaType: key.mediaType,
      tmdbId: key.tmdbId,
      season: key.season ?? 0,
      episode: key.episode ?? 0,
      positionMs: Math.max(0, Math.round(positionMs)),
      durationMs: Math.round(durationMs),
      completed,
      updatedAt: Date.now(),
    };
    return this.db
      .insert(progress)
      .values(values)
      .onConflictDoUpdate({
        target: [progress.profileId, progress.mediaType, progress.tmdbId, progress.season, progress.episode],
        set: { positionMs: values.positionMs, durationMs: values.durationMs, completed, updatedAt: values.updatedAt },
      })
      .returning()
      .get();
  }

  setWatched(profileId: number, key: ProgressKey, watched: boolean) {
    const where = this.where(profileId, key);
    if (!watched) {
      this.db.delete(progress).where(where).run();
      return;
    }
    const existing = this.db.select().from(progress).where(where).get();
    this.record(profileId, key, existing?.durationMs ?? 1, existing?.durationMs ?? 1);
  }

  get(profileId: number, key: ProgressKey): ProgressRow | undefined {
    return this.db.select().from(progress).where(this.where(profileId, key)).get();
  }

  forShow(profileId: number, showId: number): ProgressRow[] {
    return this.db.select().from(progress).where(and(eq(progress.profileId, profileId), eq(progress.mediaType, "episode"), eq(progress.tmdbId, showId))).all();
  }

  forMovies(profileId: number, ids: number[]): Map<number, ProgressRow> {
    if (!ids.length) return new Map();
    const rows = this.db.select().from(progress).where(and(eq(progress.profileId, profileId), eq(progress.mediaType, "movie"), inArray(progress.tmdbId, ids))).all();
    return new Map(rows.map((r) => [r.tmdbId, r]));
  }

  /** Partially watched items, most recent first. */
  inProgress(profileId: number, limit = 20): ProgressRow[] {
    return this.db
      .select()
      .from(progress)
      .where(and(eq(progress.profileId, profileId), eq(progress.completed, false), gt(progress.positionMs, 60_000)))
      .orderBy(desc(progress.updatedAt))
      .limit(limit)
      .all();
  }

  /** The most recently completed episode per show, for Next Up. */
  recentlyCompletedEpisodes(profileId: number, limit = 30): ProgressRow[] {
    const rows = this.db
      .select()
      .from(progress)
      .where(and(eq(progress.profileId, profileId), eq(progress.mediaType, "episode"), eq(progress.completed, true)))
      .orderBy(desc(progress.updatedAt))
      .limit(500)
      .all();
    const latest = new Map<number, ProgressRow>();
    for (const row of rows) {
      const current = latest.get(row.tmdbId);
      // The furthest episode wins, not the last one touched (rewatches of old episodes).
      if (!current || row.season > current.season || (row.season === current.season && row.episode > current.episode)) {
        latest.set(row.tmdbId, row);
      }
    }
    return [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  watchlist(profileId: number) {
    return this.db.select().from(watchlist).where(eq(watchlist.profileId, profileId)).orderBy(desc(watchlist.addedAt)).all();
  }

  inWatchlist(profileId: number, type: "movie" | "show", tmdbId: number): boolean {
    return !!this.db.select().from(watchlist).where(and(eq(watchlist.profileId, profileId), eq(watchlist.type, type), eq(watchlist.tmdbId, tmdbId))).get();
  }

  setWatchlist(profileId: number, type: "movie" | "show", tmdbId: number, on: boolean) {
    if (on) this.db.insert(watchlist).values({ profileId, type, tmdbId }).onConflictDoNothing().run();
    else this.db.delete(watchlist).where(and(eq(watchlist.profileId, profileId), eq(watchlist.type, type), eq(watchlist.tmdbId, tmdbId))).run();
  }

  private where(profileId: number, key: ProgressKey) {
    return and(
      eq(progress.profileId, profileId),
      eq(progress.mediaType, key.mediaType),
      eq(progress.tmdbId, key.tmdbId),
      eq(progress.season, key.season ?? 0),
      eq(progress.episode, key.episode ?? 0),
    );
  }
}
