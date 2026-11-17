import { z } from "zod";
import type { Shelf } from "./service";

/**
 * How a household lays out its pages: for each of Home, Movies, Shows and Anime, which rows
 * show and in what order. The rows are the page's own (Trending, Latest Releases…), the
 * per-person ones (Continue Watching, Top picks…), and any of its add-ons' catalogs. The
 * server applies it as it builds a page, so the apps get pages already laid out.
 */
export const PAGE_IDS = ["home", "movies", "shows", "anime"] as const;
export type PageId = (typeof PAGE_IDS)[number];

export const PAGE_TITLES: Record<PageId, string> = { home: "Home", movies: "Movies", shows: "Shows", anime: "Anime" };

/** Titles a rail shows unless its row says otherwise, and the most a row may ask for. */
export const ROW_ITEMS = 15;
export const MAX_ROW_ITEMS = 50;

/** One row in a page's layout: shown or not. Their order is the page's. */
export const layoutRowSchema = z.object({
  id: z.string().min(1).max(300),
  on: z.boolean(),
  /** The household's own name for it, shown in place of its own; absent: its own name. */
  name: z.string().trim().min(1).max(60).optional(),
  /** How many titles its rail shows (See all always has them all). Absent: ROW_ITEMS. */
  count: z.number().int().min(1).max(MAX_ROW_ITEMS).optional(),
});
export const pageLayoutSchema = z.array(layoutRowSchema).max(200);
export const pageLayoutsSchema = z.object(Object.fromEntries(PAGE_IDS.map((p) => [p, pageLayoutSchema.optional()])) as Record<PageId, z.ZodOptional<typeof pageLayoutSchema>>).default({});
export type PageLayout = z.infer<typeof pageLayoutSchema>;
export type PageLayouts = z.infer<typeof pageLayoutsSchema>;

/** Add-on rows a page shows at most (each is a fetch and a round of title matching). */
export const MAX_ADDON_ROWS_PER_PAGE = 12;

/** A row a page can have, as the dashboard lists it. */
export interface RowOption {
  id: string;
  title: string;
  /** Strata's own row, one made for each person, or an add-on's catalog. */
  source: "strata" | "personal" | "addon";
  /** The add-on's name, for add-on rows. */
  addon?: string;
  /** The page's big carousel at the top (shown first whatever the order says). */
  hero?: boolean;
  /** Shown when the household hasn't laid the page out yet. */
  defaultOn: boolean;
}

/** Each page's own rows, in their usual order. ("because" stands for every "Because you watched …" row.) */
export const BUILT_IN_ROWS: Record<PageId, Omit<RowOption, "defaultOn">[]> = {
  home: [
    { id: "featured", title: "Featured", source: "strata", hero: true },
    { id: "continue", title: "Continue Watching", source: "personal" },
    { id: "nextUp", title: "Up Next", source: "personal" },
    { id: "watchlist", title: "My List", source: "personal" },
    { id: "forYou", title: "Top picks for you", source: "personal" },
    { id: "because", title: "Because you watched …", source: "personal" },
    { id: "latestEpisodes", title: "Latest Episodes", source: "strata" },
    { id: "recentMovies", title: "New Movies", source: "strata" },
    { id: "trendingMovies", title: "Trending Movies", source: "strata" },
    { id: "trendingShows", title: "Trending Shows", source: "strata" },
    { id: "trendingAnime", title: "Trending Anime", source: "strata" },
  ],
  movies: [
    { id: "movies-spotlight", title: "Spotlight", source: "strata", hero: true },
    { id: "movies-trending", title: "Trending", source: "strata" },
    { id: "forYou-movie", title: "Top picks for you", source: "personal" },
    { id: "movies-latest", title: "Latest Releases", source: "strata" },
    { id: "movies-in-theaters", title: "New in Theaters", source: "strata" },
    { id: "movies-popular", title: "Popular", source: "strata" },
    { id: "movies-top-rated", title: "Top Rated", source: "strata" },
  ],
  shows: [
    { id: "shows-spotlight", title: "Spotlight", source: "strata", hero: true },
    { id: "shows-trending", title: "Trending", source: "strata" },
    { id: "forYou-show", title: "Top picks for you", source: "personal" },
    { id: "shows-latest-episodes", title: "Latest Episodes", source: "strata" },
    { id: "shows-new", title: "New Shows", source: "strata" },
    { id: "shows-popular", title: "Popular", source: "strata" },
    { id: "shows-top-rated", title: "Top Rated", source: "strata" },
    { id: "shows-coming-soon", title: "Coming Soon", source: "strata" },
  ],
  anime: [
    { id: "anime-spotlight", title: "Spotlight", source: "strata", hero: true },
    { id: "anime-trending", title: "Trending", source: "strata" },
    { id: "anime-this-season", title: "This Season", source: "strata" },
    { id: "anime-latest-episodes", title: "Latest Episodes", source: "strata" },
    { id: "anime-top-airing", title: "Airing Now", source: "strata" },
    { id: "anime-most-popular", title: "Popular", source: "strata" },
    { id: "anime-most-favorite", title: "Fan Favorites", source: "strata" },
    { id: "anime-latest-completed", title: "Recently Finished", source: "strata" },
    { id: "anime-upcoming", title: "Coming Soon", source: "strata" },
  ],
};

/** The layout row a shelf belongs to ("because:movie:27205" is the "because" row). */
export const rowIdOf = (shelfId: string) => (shelfId.startsWith("because:") ? "because" : shelfId);

/**
 * A page's shelves as the household laid it out: the rows that are on, in its order, then
 * any it doesn't mention yet (a row added since) where they'd usually be. No layout: as built.
 */
export function applyLayout(shelves: Shelf[], layout: PageLayout | undefined, opts: { cut?: boolean } = {}): Shelf[] {
  const cut = opts.cut ?? true;
  const counts = new Map((layout ?? []).map((r) => [r.id, r.count]));
  const names = new Map((layout ?? []).filter((r) => r.name).map((r) => [r.id, r.name!]));
  // Rails show as many titles as their row says (See all has them all); the hero and the
  // per-person continue rows are left whole unless a count is set.
  const trim = (s: Shelf): Shelf => {
    const renamed = names.has(rowIdOf(s.id)) && rowIdOf(s.id) !== "because" ? { ...s, title: names.get(rowIdOf(s.id))! } : s;
    if (!cut) return renamed;
    const n = counts.get(rowIdOf(s.id)) ?? (s.style === "hero" || s.kind === "continue" ? undefined : ROW_ITEMS);
    return n !== undefined && renamed.items.length > n ? { ...renamed, items: renamed.items.slice(0, n) } : renamed;
  };
  if (!layout?.length) return shelves.map(trim);
  const mentioned = new Map(layout.map((r, i) => [r.id, { on: r.on, at: i }]));
  const kept = shelves.filter((s) => mentioned.get(rowIdOf(s.id))?.on !== false);
  const placed = kept.filter((s) => mentioned.has(rowIdOf(s.id))).sort((a, b) => mentioned.get(rowIdOf(a.id))!.at - mentioned.get(rowIdOf(b.id))!.at);
  // A hero stays first: it's the page's carousel, not a rail.
  const all = [...placed, ...kept.filter((s) => !mentioned.has(rowIdOf(s.id)))];
  return [...all.filter((s) => s.style === "hero"), ...all.filter((s) => s.style !== "hero")].map(trim);
}

/** The add-on rows a page shows: those its layout turns on, or (not laid out yet) `fallback`. */
export function addonRowsOn(layout: PageLayout | undefined, fallback: string[]): string[] {
  const ids = layout?.length ? layout.filter((r) => r.on && r.id.startsWith("addon:")).map((r) => r.id) : fallback;
  return ids.slice(0, MAX_ADDON_ROWS_PER_PAGE);
}
