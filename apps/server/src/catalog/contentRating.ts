import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db";
import { profiles } from "../db/schema";
import { logger } from "../log";
import type { Settings } from "../settings";
import type { TitleType } from "./service";
import type { Tmdb, TmdbMovie, TmdbShow } from "./tmdb";

const log = logger("ratings");

/**
 * What a profile may watch. Ages are the youngest a rating allows:
 * little = G, TV-Y, TV-Y7, TV-G · kids = + PG, TV-PG · teen = + PG-13, TV-14.
 */
export const CONTENT_LIMITS = ["none", "teen", "kids", "little"] as const;
export type ContentLimit = (typeof CONTENT_LIMITS)[number];
const MAX_AGE: Record<ContentLimit, number | null> = { none: null, teen: 14, kids: 10, little: 7 };

/** Genres that make an unrated title safe enough to show under a limit. */
const FAMILY_GENRES = new Set([10751, 10762, 16]); // Family, Kids (TV), Animation
const HORROR = 27;

/** Rating given but not one we recognise: treated as adult, so a limit hides it. */
export const UNRECOGNISED = 99;

/**
 * Minimum age for a certification string; null when the title is unrated, and
 * UNRECOGNISED for a rating we can't read (fail closed).
 */
export function certificationAge(raw: string, region: string): number | null {
  const cert = raw.trim().toUpperCase();
  if (!cert || cert === "NR" || cert === "NOT RATED" || cert === "UNRATED") return null;
  const us: Record<string, number> = {
    G: 0, PG: 10, "PG-13": 13, R: 17, "NC-17": 18,
    "TV-Y": 0, "TV-Y7": 7, "TV-Y7-FV": 7, "TV-G": 0, "TV-PG": 10, "TV-14": 14, "TV-MA": 17,
  };
  const gb: Record<string, number> = { U: 0, UC: 0, PG: 10, "12A": 12, "12": 12, "15": 15, "18": 18, R18: 18 };
  const table = region === "GB" ? gb : us;
  if (cert in table) return table[cert]!;
  if (cert in us) return us[cert]!;
  // Letter ratings used elsewhere (AU, NZ, KR, JP, SG…).
  const letters: Record<string, number> = {
    AL: 0, TP: 0, ALL: 0, E: 0, P: 0, C: 0, M: 15, MA: 17, "MA15+": 15, "R16": 16, R18: 18, "R18+": 18, "R-18": 18,
    A: 18, X: 18, "X18+": 18, AO: 18, RP18: 18, NC16: 16, M18: 18, "R21": 21,
  };
  if (cert in letters) return letters[cert]!;
  // Most other countries rate by age: "12", "FSK 16", "16+", "-12", "K-7", "PG-12".
  const number = cert.match(/^[A-Z\-\s]{0,5}(\d{1,2})\s*\+?$/);
  if (number) return Number(number[1]);
  return UNRECOGNISED;
}

function movieCertification(m: TmdbMovie, region: string): string | null {
  const pick = (r: string) => {
    const dates = m.release_dates?.results.find((x) => x.iso_3166_1 === r)?.release_dates ?? [];
    // Prefer the theatrical rating (type 3), then any rating given.
    return dates.find((d) => d.type === 3 && d.certification)?.certification || dates.find((d) => d.certification)?.certification || null;
  };
  return pick(region) ?? (region !== "US" ? pick("US") : null);
}

function showCertification(s: TmdbShow, region: string): string | null {
  const pick = (r: string) => s.content_ratings?.results.find((x) => x.iso_3166_1 === r)?.rating || null;
  return pick(region) ?? (region !== "US" ? pick("US") : null);
}

/** Applies a profile's content limit to catalog lists, detail pages and playback. */
export class ContentFilter {
  private ages = new Map<string, Promise<{ age: number | null; genres: number[] }>>();

  constructor(
    private readonly db: Db,
    private readonly tmdb: Tmdb,
    private readonly settings: () => Settings,
  ) {}

  /** Max age for a profile, or null when it has no limit. */
  maxAge(profileId: number): number | null {
    const row = this.db.select({ limit: profiles.contentLimit }).from(profiles).where(eq(profiles.id, profileId)).get();
    const limit = row?.limit ?? "none";
    // A value we don't know (shouldn't happen: writes are validated) means the strictest limit.
    return limit in MAX_AGE ? MAX_AGE[limit as ContentLimit] : MAX_AGE.little;
  }

  async allowed(profileId: number, type: TitleType, tmdbId: number): Promise<boolean> {
    const maxAge = this.maxAge(profileId);
    if (maxAge === null) return true;
    return this.fits(maxAge, type, tmdbId);
  }

  /** Throws 403 for a title the profile can't see (opened by link or id). */
  async assertAllowed(profileId: number, type: TitleType, tmdbId: number) {
    if (!(await this.allowed(profileId, type, tmdbId))) throw new HTTPException(403, { message: "This title isn't available on this profile." });
  }

  /** Keeps only cards the profile may see. Lookups are cached, a few at a time. */
  async filter<T extends { type: TitleType; tmdbId: number }>(profileId: number, cards: T[]): Promise<T[]> {
    const maxAge = this.maxAge(profileId);
    if (maxAge === null || cards.length === 0) return cards;
    const keep = new Array<boolean>(cards.length).fill(false);
    let next = 0;
    const worker = async () => {
      while (next < cards.length) {
        const i = next++;
        keep[i] = await this.fits(maxAge, cards[i]!.type, cards[i]!.tmdbId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, cards.length) }, worker));
    return cards.filter((_, i) => keep[i]);
  }

  private async fits(maxAge: number, type: TitleType, tmdbId: number): Promise<boolean> {
    try {
      const { age, genres } = await this.rating(type, tmdbId);
      if (age !== null) return age <= maxAge;
      // Unrated: only family/kids/animation, and never horror.
      return genres.some((g) => FAMILY_GENRES.has(g)) && !genres.includes(HORROR);
    } catch (err) {
      // When in doubt under a limit, hide it.
      log.warn(`Couldn't rate ${type} ${tmdbId}`, err);
      return false;
    }
  }

  private rating(type: TitleType, tmdbId: number) {
    const region = this.settings().region;
    const key = `${type}:${tmdbId}:${region}`;
    let pending = this.ages.get(key);
    if (!pending) {
      pending = (async () => {
        if (type === "movie") {
          const m = await this.tmdb.movie(tmdbId);
          const cert = movieCertification(m, region);
          return { age: cert ? certificationAge(cert, region) : null, genres: m.genres.map((g) => g.id) };
        }
        const s = await this.tmdb.show(tmdbId);
        const cert = showCertification(s, region);
        return { age: cert ? certificationAge(cert, region) : null, genres: s.genres.map((g) => g.id) };
      })();
      pending.catch(() => this.ages.delete(key));
      if (this.ages.size > 5_000) this.ages.clear();
      this.ages.set(key, pending);
    }
    return pending;
  }
}
