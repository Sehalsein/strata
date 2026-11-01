import { and, asc, count, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { files, mediaItems, member, progress, type FileProvider, type MatchStatus } from "./db/schema";
import type { Matcher, MatchResult } from "./catalog/matcher";
import type { Tmdb } from "./catalog/tmdb";
import { yearOf } from "./catalog/tmdb";
import type { ParsedName } from "./media/parse";
import type { MediaInfo } from "./media/probe";
import { formatRef, mediaTypeOf, type TitleRef, type TitleType } from "./catalog/ref";
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
    /** The household whose library this is: every query is limited to it. */
    readonly organizationId: string,
    private readonly tmdb: Tmdb,
    private readonly matcher: Matcher,
  ) {}

  private mine() {
    return eq(files.organizationId, this.organizationId);
  }

  private mineItems() {
    return eq(mediaItems.organizationId, this.organizationId);
  }

  /** Inserts or refreshes a file. Changed files lose their probe and are re-matched. */
  async upsert(input: FileInput): Promise<FileRow> {
    const [existing] = await this.db.select().from(files).where(and(this.mine(), eq(files.provider, input.provider), eq(files.ref, input.ref)));
    const parsedJson = JSON.stringify(input.parsed);
    if (existing) {
      // A time where there was none (TorBox files before they carried their add date)
      // is new information, not a changed file.
      const mtimeChanged = existing.mtime !== null && existing.mtime !== (input.mtime ?? null);
      const changed = existing.size !== input.size || mtimeChanged || existing.parsedJson !== parsedJson;
      const sameMtime = existing.mtime === (input.mtime ?? null);
      if (!changed && sameMtime && !existing.missing && existing.sourceHash === (input.sourceHash ?? null)) return existing;
      const keepMatch = existing.matchStatus === "manual" || existing.matchStatus === "ignored";
      const [updated] = await this.db
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
        .where(and(this.mine(), eq(files.id, existing.id)))
        .returning();
      return updated!;
    }
    const [inserted] = await this.db
      .insert(files)
      .values({ organizationId: this.organizationId, provider: input.provider, ref: input.ref, name: input.name, size: input.size, mtime: input.mtime ?? null, parsedJson, sourceHash: input.sourceHash ?? null })
      .returning();
    return inserted!;
  }

  /** Flags files from `provider` (optionally under `refPrefix`) that a sync no longer saw. */
  async markMissing(provider: FileProvider, seenRefs: string[], refPrefix?: string) {
    const conditions = [this.mine(), eq(files.provider, provider), eq(files.missing, false)];
    if (refPrefix) conditions.push(sql`${files.ref} LIKE ${refPrefix + "%"}`);
    // Compared here rather than in SQL: a big library would exceed the bound-parameter limit.
    const rows = await this.db.select({ id: files.id, ref: files.ref }).from(files).where(and(...conditions));
    const seen = new Set(seenRefs);
    const gone = rows.filter((r) => !seen.has(r.ref)).map((r) => r.id);
    for (let i = 0; i < gone.length; i += 500) {
      await this.db.update(files).set({ missing: true, updatedAt: Date.now() }).where(and(this.mine(), inArray(files.id, gone.slice(i, i + 500))));
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
    const pending = await this.db
      .select()
      .from(files)
      .where(and(this.mine(), eq(files.missing, false), or(eq(files.matchStatus, "pending"), and(eq(files.matchStatus, "unmatched"), lt(files.updatedAt, retryBefore)))));
    let matched = 0;
    let unmatched = 0;
    for (const [i, file] of pending.entries()) {
      const parsed = JSON.parse(file.parsedJson ?? "{}") as ParsedName;
      try {
        const result = await this.matcher.match(parsed);
        if (result) {
          await this.applyMatch(file.id, result, result.season ?? parsed.season, result.episode ?? parsed.episode, "matched");
          matched++;
        } else {
          await this.db.update(files).set({ matchStatus: "unmatched", updatedAt: Date.now() }).where(and(this.mine(), eq(files.id, file.id)));
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

  /** Matches a file to a title by hand (or to the title discovery fetched it for). */
  async setManualMatch(fileId: number, ref: TitleRef, season?: number, episode?: number, status: MatchStatus = "manual") {
    // Only TMDB titles can be matched for now; AniList matches come with AniList support.
    if (ref.source !== "tmdb") throw new Error(`Can't match files to ${ref.source} titles yet`);
    const { type, id: tmdbId } = ref;
    if (type === "movie") {
      const m = await this.tmdb.movie(tmdbId);
      await this.applyMatch(fileId, { type, tmdbId, title: m.title, year: yearOf(m.release_date), posterPath: m.poster_path ?? null, backdropPath: m.backdrop_path ?? null, genreIds: m.genres.map((g) => g.id) }, undefined, undefined, status);
    } else {
      if (season === undefined || episode === undefined) throw new Error("season and episode are required for shows");
      const s = await this.tmdb.show(tmdbId);
      await this.applyMatch(fileId, { type, tmdbId, title: s.name, year: yearOf(s.first_air_date), posterPath: s.poster_path ?? null, backdropPath: s.backdrop_path ?? null, genreIds: s.genres.map((g) => g.id) }, season, episode, status);
    }
  }

  async ignore(fileId: number) {
    await this.db.update(files).set({ matchStatus: "ignored", mediaType: null, titleId: null, updatedAt: Date.now() }).where(and(this.mine(), eq(files.id, fileId)));
  }

  /** Matcher results are TMDB titles (anime included, through the anime id list). */
  private async applyMatch(fileId: number, m: MatchResult, season: number | undefined, episode: number | undefined, status: MatchStatus) {
    const source = "tmdb" as const;
    await this.db.transaction(async (tx) => {
      await tx.update(files)
        .set({
          mediaType: m.type === "movie" ? "movie" : "episode",
          source,
          titleId: m.tmdbId,
          season: m.type === "show" ? (season ?? null) : null,
          episode: m.type === "show" ? (episode ?? null) : null,
          matchStatus: status,
          updatedAt: Date.now(),
        })
        .where(and(this.mine(), eq(files.id, fileId)));
      await tx.insert(mediaItems)
        .values({ organizationId: this.organizationId, source, type: m.type, titleId: m.tmdbId, title: m.title, year: m.year, posterPath: m.posterPath, backdropPath: m.backdropPath, genreIds: m.genreIds ? JSON.stringify(m.genreIds) : null })
        .onConflictDoNothing();
      if (m.genreIds) {
        await tx.update(mediaItems)
          .set({ genreIds: JSON.stringify(m.genreIds) })
          .where(and(this.mineItems(), eq(mediaItems.source, source), eq(mediaItems.type, m.type), eq(mediaItems.titleId, m.tmdbId), isNull(mediaItems.genreIds)));
      }
    });
  }

  async saveProbe(fileId: number, info: MediaInfo) {
    await this.db.update(files).set({ probeJson: JSON.stringify(info) }).where(and(this.mine(), eq(files.id, fileId)));
  }

  byHash(hash: string): Promise<FileRow[]> {
    return this.db.select().from(files).where(and(this.mine(), eq(files.sourceHash, hash.toLowerCase()), eq(files.missing, false)));
  }

  /** Hashes of every TorBox torrent already in the library. */
  async knownHashes(): Promise<Set<string>> {
    const rows = await this.db.selectDistinct({ h: files.sourceHash }).from(files).where(and(this.mine(), eq(files.provider, "torbox"), eq(files.missing, false)));
    return new Set(rows.map((r) => r.h).filter((h): h is string => !!h));
  }

  async get(fileId: number): Promise<FileRow | undefined> {
    return (await this.db.select().from(files).where(and(this.mine(), eq(files.id, fileId))))[0];
  }

  /** Playable files of a title: a movie's, or a show's (optionally one season or episode). */
  filesFor(ref: TitleRef, season?: number, episode?: number): Promise<FileRow[]> {
    const conditions = [
      this.mine(),
      eq(files.source, ref.source),
      eq(files.mediaType, mediaTypeOf(ref.type)),
      eq(files.titleId, ref.id),
      eq(files.missing, false),
      notInArray(files.matchStatus, ["ignored", "pending", "unmatched"]),
    ];
    if (season !== undefined) conditions.push(eq(files.season, season));
    if (episode !== undefined) conditions.push(eq(files.episode, episode));
    return this.db.select().from(files).where(and(...conditions));
  }

  /** Providers available per title, for badges on catalog cards, by `formatRef`. */
  async availability(refs: TitleRef[]): Promise<Map<string, FileProvider[]>> {
    const out = new Map<string, FileProvider[]>();
    // One query per source and type (a list is nearly always one of each).
    const groups = new Map<string, TitleRef[]>();
    for (const ref of refs) {
      const key = `${ref.source}:${ref.type}`;
      groups.set(key, [...(groups.get(key) ?? []), ref]);
    }
    for (const group of groups.values()) {
      const { source, type } = group[0]!;
      const rows = await this.db
        .selectDistinct({ titleId: files.titleId, provider: files.provider })
        .from(files)
        .where(and(
          this.mine(),
          eq(files.source, source),
          eq(files.mediaType, mediaTypeOf(type)),
          inArray(files.titleId, group.map((r) => r.id)),
          eq(files.missing, false),
          inArray(files.matchStatus, ["matched", "manual"]),
        ));
      for (const row of rows) {
        const key = formatRef({ source, type, id: row.titleId! });
        out.set(key, [...(out.get(key) ?? []), row.provider]);
      }
    }
    return out;
  }

  /**
   * Titles by their newest file: when it was added to TorBox, or a local file's
   * modified time (when Strata first saw it, failing both). A show moves up when
   * a new episode arrives.
   */
  async recentlyAdded(type: TitleType, limit = 20) {
    const at = sql<number>`max(coalesce(${files.mtime}, ${files.addedAt}))`.mapWith(Number);
    const latest = (await this.db
      .select({ source: files.source, titleId: files.titleId, at })
      .from(files)
      .where(and(this.mine(), eq(files.mediaType, mediaTypeOf(type)), eq(files.missing, false), notInArray(files.matchStatus, ["ignored", "pending", "unmatched"])))
      .groupBy(files.source, files.titleId)
      .orderBy(desc(at))
      .limit(limit)).filter((r): r is typeof r & { titleId: number } => r.titleId !== null);
    if (!latest.length) return [];
    const ids = [...new Set(latest.map((r) => r.titleId))];
    const rows = await this.db.select().from(mediaItems).where(and(this.mineItems(), eq(mediaItems.type, type), inArray(mediaItems.titleId, ids)));
    const items = new Map(rows.map((m) => [`${m.source}:${m.titleId}`, m]));
    return latest.map((r) => items.get(`${r.source}:${r.titleId}`)).filter((m): m is NonNullable<typeof m> => !!m);
  }


  async list(opts: { status?: MatchStatus; provider?: FileProvider; q?: string; searchIn?: "all" | "title" | "filename"; mediaType?: "movie" | "episode"; accessed?: "yes" | "no"; sort?: "lastAccessed" | "added" | "title" | "name" | "size" | "year"; direction?: "asc" | "desc"; limit: number; offset: number }) {
    // Playback history is per title/episode and profile, not per physical file.
    const lastAccessedAt = sql<number | null>`(SELECT MAX(${progress.updatedAt}) FROM ${progress}
      WHERE ${progress.source} = ${files.source} AND ${progress.mediaType} = ${files.mediaType} AND ${progress.titleId} = ${files.titleId}
      AND ${progress.season} = COALESCE(${files.season}, 0) AND ${progress.episode} = COALESCE(${files.episode}, 0)
      AND ${progress.userId} IN (SELECT ${member.userId} FROM ${member} WHERE ${member.organizationId} = ${this.organizationId}))`.mapWith((v) => (v === null ? null : Number(v)));
    const addedAt = sql<number>`CASE WHEN ${files.provider} = 'torbox' THEN COALESCE(${files.mtime}, ${files.addedAt}) ELSE ${files.addedAt} END`.mapWith(Number);
    const title = sql<string>`COALESCE(${mediaItems.title}, ${files.parsedJson}::jsonb ->> 'title', ${files.name})`;
    const conditions = [this.mine(), eq(files.missing, false)];
    if (opts.status) conditions.push(eq(files.matchStatus, opts.status));
    if (opts.provider) conditions.push(eq(files.provider, opts.provider));
    if (opts.mediaType) conditions.push(sql`COALESCE(${files.mediaType}, ${files.parsedJson}::jsonb ->> 'kind') = ${opts.mediaType}`);
    if (opts.accessed) conditions.push(opts.accessed === "yes" ? sql`${lastAccessedAt} IS NOT NULL` : sql`${lastAccessedAt} IS NULL`);
    // Literal substring matches: % and _ in filenames are not SQL wildcards.
    for (const term of (opts.q ?? "").trim().split(/\s+/).filter(Boolean)) {
      const haystack = opts.searchIn === "title" ? title : opts.searchIn === "filename" ? files.name
        : sql`${title} || ' ' || ${files.name} || ' ' || ${files.ref}`;
      conditions.push(sql`strpos(lower(${haystack}), lower(${term})) > 0`);
    }
    const where = and(...conditions);
    const join = and(eq(mediaItems.organizationId, files.organizationId), eq(mediaItems.source, files.source), eq(mediaItems.titleId, files.titleId), eq(mediaItems.type, sql`CASE ${files.mediaType} WHEN 'movie' THEN 'movie' ELSE 'show' END`));
    const sort = opts.sort ?? "lastAccessed";
    const key = { lastAccessed: lastAccessedAt, added: addedAt, title: sql`lower(${title})`, name: sql`lower(${files.name})`, size: files.size, year: mediaItems.year }[sort];
    const order = opts.direction === "asc" ? asc(key) : desc(key);
    const rows = await this.db
      .select({ file: files, title: mediaItems.title, year: mediaItems.year, lastAccessedAt, addedAt })
      .from(files)
      .leftJoin(mediaItems, join)
      .where(where)
      .orderBy(sql`${key} IS NULL`, order, files.id)
      .limit(opts.limit)
      .offset(opts.offset);
    const total = (await this.db.select({ n: count() }).from(files).leftJoin(mediaItems, join).where(where))[0]?.n ?? 0;
    return { rows, total };
  }

  /** Puts an ignored file back into matching. */
  async unignore(fileId: number) {
    await this.db.update(files).set({ matchStatus: "pending", updatedAt: Date.now() }).where(and(this.mine(), eq(files.id, fileId), eq(files.matchStatus, "ignored")));
  }

  async titleOf(ref: TitleRef): Promise<string | null> {
    return (await this.db.select({ title: mediaItems.title }).from(mediaItems).where(and(this.mineItems(), eq(mediaItems.source, ref.source), eq(mediaItems.type, ref.type), eq(mediaItems.titleId, ref.id))))[0]?.title ?? null;
  }

  async stats() {
    const rows = await this.db
      .select({ provider: files.provider, status: files.matchStatus, count: count() })
      .from(files)
      .where(and(this.mine(), eq(files.missing, false)))
      .groupBy(files.provider, files.matchStatus);
    const items = await this.db.select({ type: mediaItems.type, count: count() }).from(mediaItems).where(this.mineItems()).groupBy(mediaItems.type);
    return { files: rows, titles: Object.fromEntries(items.map((r) => [r.type, r.count])) };
  }

  /** Removes media_items with no remaining playable files (after deletions). */
  async pruneOrphans() {
    await this.db.execute(sql`
      DELETE FROM media_items WHERE organization_id = ${this.organizationId} AND NOT EXISTS (
        SELECT 1 FROM files f WHERE f.organization_id = media_items.organization_id AND f.source = media_items.source AND f.title_id = media_items.title_id AND NOT f.missing
          AND f.match_status IN ('matched','manual')
          AND f.media_type = CASE media_items.type WHEN 'movie' THEN 'movie' ELSE 'episode' END
      )`);
  }
}
