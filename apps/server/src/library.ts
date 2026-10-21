import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { files, mediaItems, type FileProvider, type MatchStatus } from "./db/schema";
import type { Matcher, MatchResult } from "./catalog/matcher";
import type { Tmdb } from "./catalog/tmdb";
import { yearOf } from "./catalog/tmdb";
import type { ParsedName } from "./media/parse";
import type { MediaInfo } from "./media/probe";
import { logger } from "./log";

const log = logger("library");
const UNMATCHED_RETRY_MS = 24 * 60 * 60_000;

export type FileRow = typeof files.$inferSelect;

export interface FileInput {
  provider: FileProvider;
  ref: string;
  name: string;
  size: number;
  mtime?: number;
  parsed: ParsedName;
  sourceHash?: string;
}

/** The `files` table: every playable file Strata knows about, from any provider. */
export class Library {
  constructor(
    private readonly db: Db,
    private readonly tmdb: Tmdb,
    private readonly matcher: Matcher,
  ) {}

  /** Inserts or refreshes a file. Changed files lose their probe and are re-matched. */
  upsert(input: FileInput): FileRow {
    const existing = this.db.select().from(files).where(and(eq(files.provider, input.provider), eq(files.ref, input.ref))).get();
    const parsedJson = JSON.stringify(input.parsed);
    if (existing) {
      // A time where there was none (TorBox files before they carried their add date)
      // is new information, not a changed file.
      const mtimeChanged = existing.mtime !== null && existing.mtime !== (input.mtime ?? null);
      const changed = existing.size !== input.size || mtimeChanged || existing.parsedJson !== parsedJson;
      const sameMtime = existing.mtime === (input.mtime ?? null);
      if (!changed && sameMtime && !existing.missing && existing.sourceHash === (input.sourceHash ?? null)) return existing;
      const keepMatch = existing.matchStatus === "manual" || existing.matchStatus === "ignored";
      return this.db
        .update(files)
        .set({
          name: input.name,
          size: input.size,
          mtime: input.mtime ?? null,
          parsedJson,
          missing: false,
          sourceHash: input.sourceHash ?? null,
          updatedAt: Date.now(),
          ...(changed ? { probeJson: null } : {}),
          ...(changed && !keepMatch ? { matchStatus: "pending" as MatchStatus } : {}),
        })
        .where(eq(files.id, existing.id))
        .returning()
        .get();
    }
    return this.db
      .insert(files)
      .values({ provider: input.provider, ref: input.ref, name: input.name, size: input.size, mtime: input.mtime ?? null, parsedJson, sourceHash: input.sourceHash ?? null })
      .returning()
      .get();
  }

  /** Flags files from `provider` (optionally under `refPrefix`) that a sync no longer saw. */
  markMissing(provider: FileProvider, seenRefs: string[], refPrefix?: string) {
    const conditions = [eq(files.provider, provider), eq(files.missing, false)];
    if (refPrefix) conditions.push(sql`${files.ref} LIKE ${refPrefix + "%"}`);
    // SQLite caps bound parameters; compare in JS for large libraries.
    const rows = this.db.select({ id: files.id, ref: files.ref }).from(files).where(and(...conditions)).all();
    const seen = new Set(seenRefs);
    const gone = rows.filter((r) => !seen.has(r.ref)).map((r) => r.id);
    for (let i = 0; i < gone.length; i += 500) {
      this.db.update(files).set({ missing: true, updatedAt: Date.now() }).where(inArray(files.id, gone.slice(i, i + 500))).run();
    }
    if (gone.length) log.info(`${gone.length} ${provider} file(s) went missing`);
    return gone.length;
  }

  /** Matches every pending file against TMDB. Returns counts for status reporting. */
  async matchPending(onProgress?: (done: number, total: number) => void): Promise<{ matched: number; unmatched: number }> {
    if (!this.tmdb.configured) return { matched: 0, unmatched: 0 };
    // Unmatched files get another try daily: lookups that failed (an anime site down,
    // TMDB adding the title later) may succeed now.
    const retryBefore = Date.now() - UNMATCHED_RETRY_MS;
    const pending = this.db
      .select()
      .from(files)
      .where(and(eq(files.missing, false), or(eq(files.matchStatus, "pending"), and(eq(files.matchStatus, "unmatched"), lt(files.updatedAt, retryBefore)))))
      .all();
    let matched = 0;
    let unmatched = 0;
    for (const [i, file] of pending.entries()) {
      const parsed = JSON.parse(file.parsedJson ?? "{}") as ParsedName;
      try {
        const result = await this.matcher.match(parsed);
        if (result) {
          this.applyMatch(file.id, result, result.season ?? parsed.season, result.episode ?? parsed.episode, "matched");
          matched++;
        } else {
          this.db.update(files).set({ matchStatus: "unmatched", updatedAt: Date.now() }).where(eq(files.id, file.id)).run();
          unmatched++;
        }
      } catch (err) {
        log.warn(`Matching ${file.name} failed`, err);
      }
      onProgress?.(i + 1, pending.length);
    }
    if (pending.length) log.info(`Matched ${matched}, unmatched ${unmatched}`);
    return { matched, unmatched };
  }

  async setManualMatch(fileId: number, type: "movie" | "show", tmdbId: number, season?: number, episode?: number, status: MatchStatus = "manual") {
    if (type === "movie") {
      const m = await this.tmdb.movie(tmdbId);
      this.applyMatch(fileId, { type, tmdbId, title: m.title, year: yearOf(m.release_date), posterPath: m.poster_path ?? null, backdropPath: m.backdrop_path ?? null, genreIds: m.genres.map((g) => g.id) }, undefined, undefined, status);
    } else {
      if (season === undefined || episode === undefined) throw new Error("season and episode are required for shows");
      const s = await this.tmdb.show(tmdbId);
      this.applyMatch(fileId, { type, tmdbId, title: s.name, year: yearOf(s.first_air_date), posterPath: s.poster_path ?? null, backdropPath: s.backdrop_path ?? null, genreIds: s.genres.map((g) => g.id) }, season, episode, status);
    }
  }

  ignore(fileId: number) {
    this.db.update(files).set({ matchStatus: "ignored", mediaType: null, tmdbId: null, updatedAt: Date.now() }).where(eq(files.id, fileId)).run();
  }

  private applyMatch(fileId: number, m: MatchResult, season: number | undefined, episode: number | undefined, status: MatchStatus) {
    this.db.transaction((tx) => {
      tx.update(files)
        .set({
          mediaType: m.type === "movie" ? "movie" : "episode",
          tmdbId: m.tmdbId,
          season: m.type === "show" ? (season ?? null) : null,
          episode: m.type === "show" ? (episode ?? null) : null,
          matchStatus: status,
          updatedAt: Date.now(),
        })
        .where(eq(files.id, fileId))
        .run();
      tx.insert(mediaItems)
        .values({ type: m.type, tmdbId: m.tmdbId, title: m.title, year: m.year, posterPath: m.posterPath, backdropPath: m.backdropPath, genreIds: m.genreIds ? JSON.stringify(m.genreIds) : null })
        .onConflictDoNothing()
        .run();
      if (m.genreIds) {
        tx.update(mediaItems)
          .set({ genreIds: JSON.stringify(m.genreIds) })
          .where(and(eq(mediaItems.type, m.type), eq(mediaItems.tmdbId, m.tmdbId), isNull(mediaItems.genreIds)))
          .run();
      }
    });
  }

  saveProbe(fileId: number, info: MediaInfo) {
    this.db.update(files).set({ probeJson: JSON.stringify(info) }).where(eq(files.id, fileId)).run();
  }

  byHash(hash: string): FileRow[] {
    return this.db.select().from(files).where(and(eq(files.sourceHash, hash.toLowerCase()), eq(files.missing, false))).all();
  }

  /** Hashes of every TorBox torrent already in the library. */
  knownHashes(): Set<string> {
    const rows = this.db.selectDistinct({ h: files.sourceHash }).from(files).where(and(eq(files.provider, "torbox"), eq(files.missing, false))).all();
    return new Set(rows.map((r) => r.h).filter((h): h is string => !!h));
  }

  get(fileId: number): FileRow | undefined {
    return this.db.select().from(files).where(eq(files.id, fileId)).get();
  }

  filesFor(mediaType: "movie" | "episode", tmdbId: number, season?: number, episode?: number): FileRow[] {
    const conditions = [eq(files.mediaType, mediaType), eq(files.tmdbId, tmdbId), eq(files.missing, false), notInArray(files.matchStatus, ["ignored", "pending", "unmatched"])];
    if (season !== undefined) conditions.push(eq(files.season, season));
    if (episode !== undefined) conditions.push(eq(files.episode, episode));
    return this.db.select().from(files).where(and(...conditions)).all();
  }

  /** Providers available per title, for badges on catalog cards. */
  availability(type: "movie" | "show", tmdbIds: number[]): Map<number, FileProvider[]> {
    const out = new Map<number, FileProvider[]>();
    if (tmdbIds.length === 0) return out;
    const rows = this.db
      .selectDistinct({ tmdbId: files.tmdbId, provider: files.provider })
      .from(files)
      .where(and(eq(files.mediaType, type === "movie" ? "movie" : "episode"), inArray(files.tmdbId, tmdbIds), eq(files.missing, false), inArray(files.matchStatus, ["matched", "manual"])))
      .all();
    for (const row of rows) {
      const list = out.get(row.tmdbId!) ?? [];
      list.push(row.provider);
      out.set(row.tmdbId!, list);
    }
    return out;
  }

  /**
   * Titles by their newest file: when it was added to TorBox, or a local file's
   * modified time (when Strata first saw it, failing both). A show moves up when
   * a new episode arrives.
   */
  recentlyAdded(type: "movie" | "show", limit = 20) {
    const at = sql<number>`max(coalesce(${files.mtime}, ${files.addedAt}))`;
    const latest = this.db
      .select({ tmdbId: files.tmdbId, at })
      .from(files)
      .where(and(eq(files.mediaType, type === "movie" ? "movie" : "episode"), eq(files.missing, false), notInArray(files.matchStatus, ["ignored", "pending", "unmatched"])))
      .groupBy(files.tmdbId)
      .orderBy(desc(at))
      .limit(limit)
      .all();
    const ids = latest.map((r) => r.tmdbId).filter((id): id is number => id !== null);
    if (!ids.length) return [];
    const items = new Map(this.db.select().from(mediaItems).where(and(eq(mediaItems.type, type), inArray(mediaItems.tmdbId, ids))).all().map((m) => [m.tmdbId, m]));
    const when = new Map(latest.map((r) => [r.tmdbId, r.at]));
    return ids.flatMap((id) => {
      const m = items.get(id);
      return m ? [{ ...m, latestFileAt: when.get(id) ?? m.addedAt }] : [];
    });
  }


  list(opts: { status?: MatchStatus; provider?: FileProvider; limit: number; offset: number }) {
    const conditions = [eq(files.missing, false)];
    if (opts.status) conditions.push(eq(files.matchStatus, opts.status));
    if (opts.provider) conditions.push(eq(files.provider, opts.provider));
    const where = and(...conditions);
    const rows = this.db
      .select({ file: files, title: mediaItems.title, year: mediaItems.year })
      .from(files)
      .leftJoin(mediaItems, and(eq(mediaItems.tmdbId, files.tmdbId), eq(mediaItems.type, sql`CASE ${files.mediaType} WHEN 'movie' THEN 'movie' ELSE 'show' END`)))
      .where(where)
      .orderBy(files.name)
      .limit(opts.limit)
      .offset(opts.offset)
      .all();
    const total = this.db.select({ n: sql<number>`count(*)` }).from(files).where(where).get()?.n ?? 0;
    return { rows, total };
  }

  /** Puts an ignored file back into matching. */
  unignore(fileId: number) {
    this.db.update(files).set({ matchStatus: "pending", updatedAt: Date.now() }).where(and(eq(files.id, fileId), eq(files.matchStatus, "ignored"))).run();
  }

  titleOf(type: "movie" | "show", tmdbId: number): string | null {
    return this.db.select({ title: mediaItems.title }).from(mediaItems).where(and(eq(mediaItems.type, type), eq(mediaItems.tmdbId, tmdbId))).get()?.title ?? null;
  }

  stats() {
    const rows = this.db
      .select({ provider: files.provider, status: files.matchStatus, count: sql<number>`count(*)` })
      .from(files)
      .where(eq(files.missing, false))
      .groupBy(files.provider, files.matchStatus)
      .all();
    const items = this.db.select({ type: mediaItems.type, count: sql<number>`count(*)` }).from(mediaItems).groupBy(mediaItems.type).all();
    return { files: rows, titles: Object.fromEntries(items.map((r) => [r.type, r.count])) };
  }

  /** Removes media_items with no remaining playable files (after deletions). */
  pruneOrphans() {
    this.db.run(sql`
      DELETE FROM media_items WHERE NOT EXISTS (
        SELECT 1 FROM files f WHERE f.tmdb_id = media_items.tmdb_id AND f.missing = 0
          AND f.match_status IN ('matched','manual')
          AND f.media_type = CASE media_items.type WHEN 'movie' THEN 'movie' ELSE 'episode' END
      )`);
  }
}
