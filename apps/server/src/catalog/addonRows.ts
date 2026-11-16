import type { FileProvider } from "../db/schema";
import { SharedWork } from "../inFlight";
import { logger } from "../log";
import { globalFetch } from "../net";
import { runtime } from "#runtime";
import { addonCatalogItems, catalogKey, hasCatalogs, MAX_HOME_ROWS, type AddonCatalog, type AddonMeta, type StreamAddon } from "../sources/addons";
import { formatRef, type TitleRef } from "./ref";
import type { Shelf, TitleCard } from "./service";
import type { TitleIds } from "./titleIds";

const log = logger("addon-rows");

/** A source of Home rows besides TMDB's own (add-on catalogs today; others can join). */
export interface ShelfSource {
  /** Its rows, in order. Never throws: a row that fails or is slow is left out. */
  shelves(): Promise<Shelf[]>;
}

/** Cards per row, like the other rails. */
const ROW_LENGTH = 20;
/** How long Home waits for one row; a slower one carries on and is there next time. */
const ROW_BUDGET_MS = 6_000;
/** Catalogs move slowly; each is asked again after this. */
const ITEMS_TTL_MS = 60 * 60_000;

/**
 * The household's add-on catalogs it put on Home (AIO Metadata's trending, an MDBList list…),
 * as rows of ordinary titles: each item is matched to Strata's own title (see TitleIds), so
 * it opens, plays and keeps progress like any other. The apps only ever see rows of titles.
 */
export class AddonRows implements ShelfSource {
  private items = new SharedWork<string, AddonMeta[]>({ remember: true, ttlMs: ITEMS_TTL_MS, max: 200 });

  constructor(
    private readonly addons: () => StreamAddon[],
    private readonly ids: TitleIds,
    /** TMDB's own cards for titles, by ref (CatalogService.titleCards). */
    private readonly titleCards: (refs: TitleRef[]) => Promise<Map<string, TitleCard>>,
    private readonly availability: (refs: TitleRef[]) => Promise<Map<string, FileProvider[]>>,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  async shelves(): Promise<Shelf[]> {
    const rows = this.addons()
      .filter((a) => a.enabled && hasCatalogs(a))
      .flatMap((addon) => addon.catalogs.filter((c) => c.home).map((catalog) => ({ addon, catalog })))
      // Saving the setting enforces the cap too; this holds it for lists saved before.
      .slice(0, MAX_HOME_ROWS);
    const shelves = await Promise.all(
      rows.map(async ({ addon, catalog }) => {
        const work = this.row(addon, catalog);
        const timedOut = Symbol();
        const result = await Promise.race([work, runtime.sleep(ROW_BUDGET_MS).then(() => timedOut)]).catch((err) => {
          log.warn(`${addon.name}: ${catalog.name} failed`, err);
          return null;
        });
        if (result === timedOut) {
          runtime.background(work.then(() => {}).catch(() => {}));
          log.info(`${addon.name}: ${catalog.name} is slow; it'll be on Home next time`);
          return null;
        }
        return result as Shelf | null;
      }),
    );
    return shelves.filter((s): s is Shelf => !!s && s.items.length > 0);
  }

  private async row(addon: StreamAddon, catalog: AddonCatalog): Promise<Shelf> {
    const key = `${addon.id}:${addon.url}:${catalogKey(catalog)}`;
    const metas = await this.items.get(key, () => addonCatalogItems(addon, catalog, this.fetchImpl));
    const placed = await Promise.all(metas.slice(0, ROW_LENGTH * 2).map(async (m) => ({ meta: m, ref: await this.ids.resolve(m.id, m.type === "movie" ? "movie" : "show") })));
    const seen = new Set<string>();
    const kept = placed
      .filter((p): p is { meta: AddonMeta; ref: TitleRef } => {
        if (!p.ref) return false;
        const k = formatRef(p.ref);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, ROW_LENGTH);
    // What the card says comes from TMDB, the title Strata knows (and a profile's limit
    // judges); only the poster may be the add-on's (see TitleCard.addonPosterUrl). A title
    // TMDB doesn't have (an AniList one) keeps the add-on's name, without its words.
    const refs = kept.map((k) => k.ref);
    const [tmdbCards, avail] = await Promise.all([this.titleCards(refs), this.availability(refs)]);
    const items: TitleCard[] = kept.map(({ meta, ref }) => {
      const key = formatRef(ref);
      const tmdb = tmdbCards.get(key);
      const base: TitleCard = tmdb ?? {
        type: ref.type,
        ref: key,
        title: meta.name,
        year: Number(/\b(\d{4})/.exec(meta.releaseInfo ?? "")?.[1]) || null,
        posterUrl: null,
        backdropUrl: null,
        available: avail.get(key) ?? [],
      };
      return meta.poster ? { ...base, addonPosterUrl: meta.poster } : base;
    });
    return { id: `addon:${addon.id}:${catalogKey(catalog)}`, title: rowTitle(catalog), kind: "titles", items };
  }
}

/** The row's name on Home: the catalog's, saying movies or shows when it doesn't ("Popular" → "Popular Movies"). */
export function rowTitle(catalog: Pick<AddonCatalog, "name" | "type">): string {
  if (/\b(movies?|films?|shows?|series|tv|anime)\b/i.test(catalog.name)) return catalog.name;
  return `${catalog.name} ${catalog.type === "movie" ? "Movies" : "Shows"}`;
}
