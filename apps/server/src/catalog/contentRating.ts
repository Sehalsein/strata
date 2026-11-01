import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db";
import { member } from "../db/schema";
import { logger } from "../log";
import type { Settings } from "../settings";
import { parseRef, type TitleRef } from "./ref";
import type { Tmdb, TmdbMovie, TmdbShow } from "./tmdb";
import { SharedWork } from "../inFlight";
import type { AnimeIds } from "./anime/ids";
import type { Kitsu } from "./anime/kitsu";

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

const LETTERS_BY_REGION: Record<string, Record<string, number>> = {
  AU: { G: 0, PG: 10, M: 15, "MA15+": 15, "R18+": 18, "X18+": 18, RC: 99 },
  NZ: { G: 0, PG: 10, M: 16, R13: 13, R15: 15, R16: 16, R18: 18, R: 18 },
  SG: { G: 0, PG: 10, PG13: 13, NC16: 16, M18: 18, R21: 21 },
  MX: { AA: 0, A: 0, B: 12, B15: 15, C: 18, D: 18 },
  JP: { G: 0, PG12: 12, "R15+": 15, "R18+": 18 },
  KR: { ALL: 0, "12": 12, "15": 15, "18": 18, "청소년관람불가": 18 },
  FR: { U: 0, TP: 0 },
  ES: { A: 0, APTA: 0 },
  IN: { U: 0, UA: 12, A: 18, S: 18 },
  BR: { L: 0, AL: 0 },
};

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
  // Letter ratings mean different things per country ("C" is all ages in some places,
  // adults-only in Mexico), so they're only read for the region they belong to.
  const letters = LETTERS_BY_REGION[region];
  if (letters && cert in letters) return letters[cert]!;
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

/** TMDB's certification for a title in `region` (else the US one), and its genres. */
async function tmdbRating(tmdb: Tmdb, type: TitleRef["type"], tmdbId: number, region: string): Promise<{ certification: string | null; genres: number[] }> {
  if (type === "movie") {
    const m = await tmdb.movie(tmdbId);
    return { certification: movieCertification(m, region), genres: m.genres.map((g) => g.id) };
  }
  const s = await tmdb.show(tmdbId);
  return { certification: showCertification(s, region), genres: s.genres.map((g) => g.id) };
}

/**
 * Kitsu's age ratings, as the youngest age each allows (Kitsu's PG is "Children").
 * R18 is adult content: it never fits a limit.
 */
const KITSU_AGES: Record<string, number> = { G: 0, PG: 7, R: 17, R18: UNRECOGNISED };

export interface AnimeRatingSources {
  ids: AnimeIds;
  kitsu?: Kitsu;
  tmdb: Tmdb;
  region: string;
}

/**
 * An AniList title's rating: Kitsu's age rating, through Fribb's ids, else TMDB's
 * certification for the title Fribb maps it to. `age` is null when neither knows.
 */
export async function animeRating(type: TitleRef["type"], anilistId: number, src: AnimeRatingSources): Promise<{ certification: string | null; age: number | null }> {
  const none = { certification: null, age: null };
  await src.ids.ready().catch(() => {});
  const entry = src.ids.anilist(anilistId);
  if (!entry) return none;
  let kitsuFailed: unknown;
  if (entry.kitsuId && src.kitsu) {
    // Kitsu unreachable: TMDB's rating, if there is one, will do.
    const rating = await src.kitsu.ageRating(entry.kitsuId).catch((err) => ((kitsuFailed = err), null));
    if (rating) return { certification: rating, age: KITSU_AGES[rating.toUpperCase()] ?? UNRECOGNISED };
  }
  // Fribb sometimes maps a film to a TMDB show (or a special to a film): either will do.
  const tmdb: [TitleRef["type"], number | undefined] =
    type === "movie" ? (entry.tmdbMovie ? ["movie", entry.tmdbMovie] : ["show", entry.tmdbTv]) : entry.tmdbTv ? ["show", entry.tmdbTv] : ["movie", entry.tmdbMovie];
  const { certification } = tmdb[1] ? await tmdbRating(src.tmdb, tmdb[0], tmdb[1], src.region) : { certification: null };
  // Not knowing because Kitsu failed isn't "unrated": thrown, so it isn't remembered.
  if (!certification && kitsuFailed) throw kitsuFailed;
  return { certification, age: certification ? certificationAge(certification, src.region) : null };
}

/** Applies a profile's content limit to catalog lists, detail pages and playback. */
export class ContentFilter {
  /** Ratings looked up, by title and region (failures aren't kept). */
  private ages = new SharedWork<string, { age: number | null; genres: number[] }>({ remember: true, max: 5_000 });

  constructor(
    private readonly db: Db,
    /** The household whose members' limits apply. */
    private readonly organizationId: string,
    private readonly tmdb: Tmdb,
    private readonly settings: () => Settings,
    /** For AniList titles' ratings (see `animeRating`); without it they're hidden under a limit. */
    private readonly anime?: { ids: AnimeIds; kitsu?: Kitsu },
  ) {}

  /** Max age for a profile, or null when it has no limit. */
  async maxAge(userId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ limit: member.contentLimit })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, this.organizationId)));
    const limit = row?.limit ?? "none";
    // A value we don't know (shouldn't happen: writes are validated) means the strictest limit.
    return limit in MAX_AGE ? MAX_AGE[limit as ContentLimit] : MAX_AGE.little;
  }

  async allowed(userId: string, ref: TitleRef): Promise<boolean> {
    const maxAge = await this.maxAge(userId);
    if (maxAge === null) return true;
    return this.fits(maxAge, ref);
  }

  /** Throws 403 for a title the profile can't see (opened by link or id). */
  async assertAllowed(userId: string, ref: TitleRef) {
    if (!(await this.allowed(userId, ref))) throw new HTTPException(403, { message: "This title isn't available to this account." });
  }

  /** Keeps only cards the profile may see (by their `ref`). Lookups are cached, a few at a time. */
  async filter<T extends { ref: string }>(userId: string, cards: T[]): Promise<T[]> {
    const maxAge = await this.maxAge(userId);
    if (maxAge === null || cards.length === 0) return cards;
    const keep = new Array<boolean>(cards.length).fill(false);
    let next = 0;
    const worker = async () => {
      while (next < cards.length) {
        const i = next++;
        const ref = parseRef(cards[i]!.ref);
        keep[i] = ref ? await this.fits(maxAge, ref) : false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, cards.length) }, worker));
    return cards.filter((_, i) => keep[i]);
  }

  private async fits(maxAge: number, ref: TitleRef): Promise<boolean> {
    const { type, id } = ref;
    try {
      // AniList titles: Kitsu's or TMDB's rating (see `animeRating`); unknown is hidden.
      if (ref.source === "anilist") {
        const { age } = await this.rating(ref);
        return age !== null && age <= maxAge;
      }
      const { age, genres } = await this.rating(ref);
      if (age !== null) return age <= maxAge;
      // Unrated: only family/kids/animation, and never horror.
      return genres.some((g) => FAMILY_GENRES.has(g)) && !genres.includes(HORROR);
    } catch (err) {
      // When in doubt under a limit, hide it.
      log.warn(`Couldn't rate ${ref.source} ${type} ${id}`, err);
      return false;
    }
  }

  private rating(ref: TitleRef) {
    const region = this.settings().region;
    const key = `${ref.source}:${ref.type}:${ref.id}:${region}`;
    return this.ages.get(key, async () => {
      if (ref.source === "anilist") {
        if (!this.anime) return { age: null, genres: [] };
        const { age } = await animeRating(ref.type, ref.id, { ...this.anime, tmdb: this.tmdb, region });
        return { age, genres: [] };
      }
      const { certification, genres } = await tmdbRating(this.tmdb, ref.type, ref.id, region);
      return { age: certification ? certificationAge(certification, region) : null, genres };
    });
  }
}
