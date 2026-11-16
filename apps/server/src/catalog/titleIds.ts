import { logger } from "../log";
import { SharedWork } from "../inFlight";
import type { AnimeIds } from "./anime/ids";
import { tmdbRef, type TitleRef } from "./ref";
import type { Tmdb } from "./tmdb";
import type { TitleType } from "./service";

const log = logger("title-ids");

/**
 * Turns the ids other catalogs use for a title into Strata's own title (a TMDB movie or
 * show, or an AniList title TMDB doesn't have), so a title from anywhere opens, plays and
 * keeps progress like any other. The one place that knows other sites' ids:
 *
 * - "tmdb:278", "tmdb:movie:278"             TMDB's own
 * - "tt0111161"                               IMDb, looked up on TMDB
 * - "tvdb:81189"                              TVDB, looked up on TMDB
 * - "kitsu:1376", "mal:5114", "anilist:21"    anime, through the anime id list
 *
 * Anything else, or an id nobody knows, is null.
 */
export class TitleIds {
  private found = new SharedWork<string, TitleRef | null>({ remember: true, ttlMs: 7 * 24 * 3_600_000, max: 20_000 });

  constructor(
    private readonly tmdb: Tmdb,
    private readonly anime?: AnimeIds,
  ) {}

  resolve(id: string, type: TitleType): Promise<TitleRef | null> {
    const key = `${type}:${id}`;
    return this.found
      .get(key, () => this.lookup(id.trim(), type))
      .catch((err) => {
        log.debug(`Couldn't place ${key}`, err);
        return null;
      });
  }

  private async lookup(id: string, type: TitleType): Promise<TitleRef | null> {
    let m: RegExpExecArray | null;
    // A season or episode suffix ("tt0944947:1:2") names the show.
    if ((m = /^(tt\d{1,10})(?::\d+:\d+)?$/.exec(id))) return this.viaTmdb(m[1]!, "imdb_id", type);
    if ((m = /^tmdb:(?:(movie|tv|series|show):)?(\d{1,10})$/.exec(id))) {
      const t = m[1] ? (m[1] === "movie" ? "movie" : "show") : type;
      return tmdbRef(t, Number(m[2]));
    }
    if ((m = /^tvdb:(\d{1,10})$/.exec(id))) return this.viaTmdb(m[1]!, "tvdb_id", type);
    if ((m = /^(kitsu|mal|anilist):(\d{1,10})(?::\d+)?$/.exec(id))) return this.viaAnime(m[1] as "kitsu" | "mal" | "anilist", Number(m[2]), type);
    return null;
  }

  private async viaTmdb(externalId: string, source: "imdb_id" | "tvdb_id", type: TitleType): Promise<TitleRef | null> {
    const r = await this.tmdb.find(externalId, source);
    const movie = r.movie_results[0];
    const show = r.tv_results[0];
    // The catalog's type comes first; a film listed as a series (or the other way) still lands.
    if (type === "movie") return movie ? tmdbRef("movie", movie.id) : show ? tmdbRef("show", show.id) : null;
    return show ? tmdbRef("show", show.id) : movie ? tmdbRef("movie", movie.id) : null;
  }

  private async viaAnime(site: "kitsu" | "mal" | "anilist", n: number, type: TitleType): Promise<TitleRef | null> {
    if (!this.anime) return site === "anilist" ? { source: "anilist", type, id: n } : null;
    await this.anime.ready();
    const entry = site === "kitsu" ? this.anime.kitsu(n) : site === "mal" ? this.anime.mal(n) : this.anime.anilist(n);
    // TMDB's title where it has one, so the anime sits with the rest of the catalog; else AniList's.
    if (entry?.tmdbMovie && (type === "movie" || !entry.tmdbTv)) return tmdbRef("movie", entry.tmdbMovie);
    if (entry?.tmdbTv) return tmdbRef("show", entry.tmdbTv);
    const anilistId = site === "anilist" ? n : entry?.anilistId;
    return anilistId ? { source: "anilist", type, id: anilistId } : null;
  }
}
