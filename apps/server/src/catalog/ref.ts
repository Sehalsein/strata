import type { TitleType } from "./service";
export type { TitleType };

/**
 * Where a title's identity comes from: TMDB for movies and TV, AniList for anime.
 * Each is the best source for its category; a title is only ever known by one.
 */
export type TitleSource = "tmdb" | "anilist";
export const TITLE_SOURCES: readonly TitleSource[] = ["tmdb", "anilist"];

/** A movie or show, by its source's id. On the wire: "tmdb:show:1399", "anilist:show:154587". */
export interface TitleRef {
  source: TitleSource;
  type: TitleType;
  id: number;
}

const PATTERN = /^(tmdb|anilist):(movie|show):([1-9]\d{0,9})$/;

export function formatRef(ref: TitleRef): string {
  return `${ref.source}:${ref.type}:${ref.id}`;
}

/** The ref in `text`, or null when it isn't one (unknown source, type or id). */
export function parseRef(text: string): TitleRef | null {
  const m = PATTERN.exec(text);
  if (!m) return null;
  const id = Number(m[3]);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;
  return { source: m[1] as TitleSource, type: m[2] as TitleType, id };
}

export const tmdbRef = (type: TitleType, id: number): TitleRef => ({ source: "tmdb", type, id });

export const sameRef = (a: TitleRef, b: TitleRef) => a.source === b.source && a.type === b.type && a.id === b.id;

/** What plays or keeps progress: a movie, or an episode of a show, by its source's id. */
export interface TitleTarget {
  source: TitleSource;
  mediaType: "movie" | "episode";
  /** The movie's id, or the show's for an episode. */
  titleId: number;
  season?: number;
  episode?: number;
}

/** The title a target belongs to (an episode's show). */
export const targetRef = (t: Pick<TitleTarget, "source" | "mediaType" | "titleId">): TitleRef => ({
  source: t.source,
  type: t.mediaType === "movie" ? "movie" : "show",
  id: t.titleId,
});

/** The media type files and progress are kept under for a title type. */
export const mediaTypeOf = (type: TitleType): "movie" | "episode" => (type === "movie" ? "movie" : "episode");
