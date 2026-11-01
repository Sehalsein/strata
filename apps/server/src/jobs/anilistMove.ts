import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { rowsOf } from "../db";
import { continueHidden, files, mediaItems, member, progress, watchlist } from "../db/schema";
import type { Anilist } from "../catalog/anime/anilist";
import { anilistEpisode, type AnimeEntry, type AnimeIds } from "../catalog/anime/ids";
import { anilistMatch } from "../catalog/anime/match";
import type { MatchResult } from "../catalog/matcher";
import type { Tmdb } from "../catalog/tmdb";
import type { Library } from "../library";
import { logger } from "../log";

const log = logger("anime-move");

/** strata_meta key recording that a household's anime has been moved. */
export const moveMarker = (organizationId: string) => `anilist-move:${organizationId}`;

type Where = { anilistId: number; season: number; episode: number };

export interface MoveResult {
  skipped?: string;
  files: number;
  progress: number;
  watchlist: number;
  hidden: number;
  /** Something couldn't be placed for now (TMDB or AniList didn't answer): it runs again. */
  incomplete?: boolean;
}

/**
 * Moves a household's anime from TMDB titles to AniList ones, once: its files and
 * library titles, and its members' progress, My List and hidden titles. Anime is what
 * the anime id list maps to AniList. Episodes are placed through TMDB's numbering on the
 * AniList entry (season or cour) they belong to; what can't be placed stays TMDB's.
 * A show on a list goes to the entry its member is furthest into, else its first
 * season's. Where a row already exists under the AniList title, the newer one is kept.
 * Safe to run again: it records when it's done, and only moves rows that are TMDB's.
 */
export class AnimeMove {
  /** TMDB's seasons per show, or null when TMDB can't say. */
  private seasons = new Map<number, { season: number; episodes: number }[] | null>();
  private incomplete = false;

  constructor(
    private readonly db: Db,
    private readonly organizationId: string,
    private readonly library: Library,
    private readonly anime: { ids: AnimeIds; anilist: Anilist },
    private readonly tmdb: Tmdb,
  ) {}

  async run(): Promise<MoveResult> {
    const done = { files: 0, progress: 0, watchlist: 0, hidden: 0 };
    const marker = moveMarker(this.organizationId);
    if (rowsOf(await this.db.execute(sql`SELECT 1 FROM strata_meta WHERE key = ${marker}`)).length) return { skipped: "already moved", ...done };
    const { ids } = this.anime;
    await ids.ready();
    if (!ids.size) return { skipped: "the anime id list isn't loaded yet", ...done };

    const users = (await this.db.select({ id: member.userId }).from(member).where(eq(member.organizationId, this.organizationId))).map((m) => m.id);
    done.files = await this.moveFiles();
    if (users.length) {
      // List entries look at progress as it was (TMDB's), so they're placed first.
      done.watchlist = await this.moveListed(users, "watchlist");
      done.hidden = await this.moveListed(users, "hidden");
      done.progress = await this.moveProgress(users);
    }
    await this.library.pruneOrphans();
    if (this.incomplete) return { ...done, incomplete: true };
    await this.db.execute(sql`INSERT INTO strata_meta (key, value) VALUES (${marker}, ${String(Date.now())}) ON CONFLICT (key) DO NOTHING`);
    if (done.files + done.progress + done.watchlist + done.hidden) log.info(`Moved anime to AniList for household ${this.organizationId.slice(0, 8)}`, done);
    return done;
  }

  /** The AniList movie a TMDB movie is, or undefined. */
  private movie(tmdbId: number): number | undefined {
    return this.anime.ids.movie(tmdbId)?.anilistId;
  }

  /** The show's entries that have an AniList id (none: not anime). */
  private entries(tmdbId: number): AnimeEntry[] {
    return this.anime.ids.show(tmdbId).filter((e) => e.anilistId);
  }

  /** The AniList entry and episode for a TMDB episode, or null (not anime, or it can't be placed now). */
  private async episode(tmdbId: number, season: number, episode: number): Promise<Where | null> {
    const entries = this.entries(tmdbId);
    if (!entries.length) return null;
    // Absolute numbering needs TMDB's season lengths.
    let seasons: { season: number; episodes: number }[] = [];
    if (entries.some((e) => e.tmdbSeason === undefined) && !entries.some((e) => e.tmdbSeason === season)) {
      if (!this.seasons.has(tmdbId)) {
        const show = await this.tmdb.show(tmdbId).catch((err) => (log.warn(`TMDB show ${tmdbId} for the anime move failed`, err), null));
        this.seasons.set(tmdbId, show ? show.seasons.map((s) => ({ season: s.season_number, episodes: s.episode_count })) : null);
      }
      const known = this.seasons.get(tmdbId);
      if (!known) {
        this.incomplete = true;
        return null;
      }
      seasons = known;
    }
    const at = anilistEpisode(entries, season, episode, seasons);
    return at && { anilistId: at.anilistId, season: 1, episode: at.episode };
  }

  /** The show's first season's AniList entry (not specials). */
  private firstEntry(tmdbId: number): number | undefined {
    const entries = this.entries(tmdbId);
    return (entries.find((e) => e.tmdbSeason !== 0) ?? entries[0])?.anilistId;
  }

  private async moveFiles(): Promise<number> {
    const rows = await this.db
      .select()
      .from(files)
      .where(and(eq(files.organizationId, this.organizationId), eq(files.source, "tmdb"), isNotNull(files.titleId), isNotNull(files.mediaType)));
    const titles = new Map<string, MatchResult | null>();
    /** The AniList title's library row (looked up once); null when it isn't one (AniList's format differs). */
    const title = async (type: "movie" | "show", id: number) => {
      const key = `${type}:${id}`;
      if (!titles.has(key)) titles.set(key, await anilistMatch(this.anime.anilist, type, id));
      return titles.get(key)!;
    };
    let moved = 0;
    for (const f of rows) {
      let where: Where | null = null;
      if (f.mediaType === "movie") {
        const id = this.movie(f.titleId!);
        where = id ? { anilistId: id, season: 0, episode: 0 } : null;
      } else if (f.season !== null && f.episode !== null) {
        where = await this.episode(f.titleId!, f.season, f.episode);
      }
      if (!where) continue;
      const type = f.mediaType === "movie" ? "movie" : "show";
      let item: MatchResult | null;
      try {
        item = await title(type, where.anilistId);
      } catch (err) {
        log.warn(`AniList ${where.anilistId} for the anime move failed`, err);
        this.incomplete = true;
        continue;
      }
      if (!item) continue;
      await this.db.transaction(async (tx) => {
        await tx
          .update(files)
          .set({
            source: "anilist",
            titleId: where.anilistId,
            season: type === "show" ? 1 : null,
            episode: type === "show" ? where.episode : null,
            updatedAt: Date.now(),
          })
          .where(eq(files.id, f.id));
        await tx
          .insert(mediaItems)
          .values({ organizationId: this.organizationId, source: "anilist", type, titleId: where.anilistId, title: item.title, year: item.year, posterPath: item.posterPath, backdropPath: item.backdropPath })
          .onConflictDoNothing();
      });
      moved++;
    }
    return moved;
  }

  private async moveProgress(users: string[]): Promise<number> {
    const rows = await this.db.select().from(progress).where(and(inArray(progress.userId, users), eq(progress.source, "tmdb")));
    let moved = 0;
    for (const p of rows) {
      const where = p.mediaType === "movie" ? (this.movie(p.titleId) ? { anilistId: this.movie(p.titleId)!, season: 0, episode: 0 } : null) : await this.episode(p.titleId, p.season, p.episode);
      if (!where) continue;
      const key = (source: "tmdb" | "anilist", titleId: number, season: number, episode: number) =>
        and(eq(progress.userId, p.userId), eq(progress.source, source), eq(progress.mediaType, p.mediaType), eq(progress.titleId, titleId), eq(progress.season, season), eq(progress.episode, episode));
      const target = key("anilist", where.anilistId, where.season, where.episode);
      await this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(progress).where(target);
        const old = key("tmdb", p.titleId, p.season, p.episode);
        // Already there: the newer of the two stays.
        if (existing && existing.updatedAt >= p.updatedAt) return void (await tx.delete(progress).where(old));
        if (existing) await tx.delete(progress).where(target);
        await tx.update(progress).set({ source: "anilist", titleId: where.anilistId, season: where.season, episode: where.episode }).where(old);
      });
      moved++;
    }
    return moved;
  }

  /** My List or hidden titles: a show goes to the AniList entry its member is furthest into. */
  private async moveListed(users: string[], which: "watchlist" | "hidden"): Promise<number> {
    const table = which === "watchlist" ? watchlist : continueHidden;
    const rows = await this.db.select().from(table).where(and(inArray(table.userId, users), eq(table.source, "tmdb")));
    let moved = 0;
    for (const r of rows) {
      const at = "addedAt" in r ? r.addedAt : r.hiddenAt;
      const anilistId = r.type === "movie" ? this.movie(r.titleId) : this.entries(r.titleId).length ? ((await this.furthest(r.userId, r.titleId)) ?? this.firstEntry(r.titleId)) : undefined;
      if (!anilistId) continue;
      const key = (source: "tmdb" | "anilist", titleId: number) => and(eq(table.userId, r.userId), eq(table.source, source), eq(table.type, r.type), eq(table.titleId, titleId));
      await this.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(table).where(key("anilist", anilistId));
        const existingAt = existing ? ("addedAt" in existing ? existing.addedAt : existing.hiddenAt) : undefined;
        if (existingAt !== undefined && existingAt >= at) return void (await tx.delete(table).where(key("tmdb", r.titleId)));
        if (existing) await tx.delete(table).where(key("anilist", anilistId));
        await tx.update(table).set({ source: "anilist", titleId: anilistId }).where(key("tmdb", r.titleId));
      });
      moved++;
    }
    return moved;
  }

  /** The AniList entry of the furthest TMDB episode this person has progress on, if any places. */
  private async furthest(userId: string, tmdbId: number): Promise<number | undefined> {
    const watched = (await this.db
      .select({ season: progress.season, episode: progress.episode })
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.source, "tmdb"), eq(progress.mediaType, "episode"), eq(progress.titleId, tmdbId))))
      .sort((a, b) => b.season - a.season || b.episode - a.episode);
    for (const w of watched) {
      const where = await this.episode(tmdbId, w.season, w.episode);
      if (where) return where.anilistId;
    }
    return undefined;
  }
}
