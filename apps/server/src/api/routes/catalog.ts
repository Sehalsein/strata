import { serveRange } from "./stream";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, cacheFor, DAY, HOUR, intParam, optionalInt, requireAuth, requireHousehold, userOf, type Env } from "../context";
import { capsSchema } from "../../playback/decide";
import { NeedsProbeError } from "../../playback/service";
import { mediaInfoSchema } from "../../media/probe";
import { parseRef, tmdbRef, type TitleRef, type TitleTarget } from "../../catalog/ref";
import { legacyCards, type Shelf } from "../../catalog/service";

/** A title by its ref ("tmdb:show:1399"), for path and query params; 400 when it isn't one. */
function refParam(text: string | undefined): TitleRef {
  const ref = parseRef(text ?? "");
  if (!ref) throw new HTTPException(400, { message: "Invalid title ref" });
  return ref;
}

/**
 * A movie or episode in a request body: `{ ref, season?, episode? }`, or as older apps send
 * it, `{ mediaType, tmdbId, season?, episode? }` (TMDB's). See `toTarget`.
 */
const targetFields = {
  ref: z.string().optional(),
  mediaType: z.enum(["movie", "episode"]).optional(),
  tmdbId: z.number().int().optional(),
  season: z.number().int().min(0).optional(),
  episode: z.number().int().min(0).optional(),
};

type TargetInput = { ref?: string; mediaType?: "movie" | "episode"; tmdbId?: number; season?: number; episode?: number };

/** The title a body with `targetFields` names, with the rest of the body; 400 when it names none. */
function toTarget<T extends TargetInput>(input: T): Omit<T, keyof TargetInput> & TitleTarget {
  const { ref: text, mediaType, tmdbId, season, episode, ...rest } = input;
  let title: Pick<TitleTarget, "source" | "mediaType" | "titleId">;
  if (text !== undefined) {
    const ref = refParam(text);
    title = { source: ref.source, mediaType: ref.type === "movie" ? "movie" : "episode", titleId: ref.id };
  } else if (mediaType !== undefined && tmdbId !== undefined) {
    title = { source: "tmdb", mediaType, titleId: tmdbId };
  } else {
    throw new HTTPException(400, { message: "ref, or mediaType and tmdbId, is required" });
  }
  if (title.mediaType === "episode" && (season === undefined || episode === undefined)) throw new HTTPException(400, { message: "season and episode are required for episodes" });
  return { ...rest, ...title, season, episode };
}

/** A title on its own (My List): `{ ref }`, or as older apps send it, `{ type, tmdbId }`. */
function toTitle(input: { ref?: string; type?: "movie" | "show"; tmdbId?: number }): TitleRef {
  if (input.ref !== undefined) return refParam(input.ref);
  if (input.type !== undefined && input.tmdbId !== undefined) return tmdbRef(input.type, input.tmdbId);
  throw new HTTPException(400, { message: "ref, or type and tmdbId, is required" });
}

/**
 * Cards as the asking app can use them. Apps that key titles by ref say so with
 * `X-Strata-Refs: 1`; older ones key them by TMDB id, so they get only titles TMDB has,
 * once each (two AniList seasons of one TMDB show would be the same card to them).
 */
function forApp<T extends { type: string; tmdbId?: number }>(c: Context<Env>, cards: T[]): T[] {
  c.header("Vary", "X-Strata-Refs");
  return c.req.header("X-Strata-Refs") === "1" ? cards : legacyCards(cards);
}

function shelvesForApp(c: Context<Env>, shelves: Shelf[]): Shelf[] {
  return shelves.map((shelf) => ({ ...shelf, items: forApp(c, shelf.items) })).filter((shelf) => shelf.items.length > 0);
}

/** What play and download both take, besides the title. */
const prepareFields = {
  candidateId: z.string().optional(),
  audioStreamIndex: z.number().int().optional(),
  preferMaxHeight: z.number().int().min(240).optional(),
  caps: capsSchema.prefault({}),
};

/** A file the server can't read yet: the app reads its details itself, sends them, and asks again. */
async function needsProbe(c: Context<Env>, prepare: () => Promise<object>) {
  try {
    return c.json(await prepare());
  } catch (err) {
    if (err instanceof NeedsProbeError) return c.json({ needsProbe: { fileId: err.fileId, url: err.url } }, 428);
    throw err;
  }
}

/** The signed-in person's view of the household's catalog, with their content limit applied. */
const viewer = (c: Context<Env>) => c.var.household.viewer(userOf(c));

// How long the apps keep each answer (see cacheFor). Catalog lists and title pages barely
// change; the calendar follows the person's list, which the apps drop themselves when they
// change it. Home's own rails (Continue Watching, Next Up, My List) aren't kept at all.
const TTL = { catalog: DAY, title: DAY, calendar: 6 * HOUR, search: HOUR } as const;

export const catalogRoutes = new Hono<Env>()
  .use(requireAuth, requireHousehold)

  // Both parts at once, for apps that don't ask for them separately.
  .get("/home", async (c) => c.json({ shelves: shelvesForApp(c, await viewer(c).home()) }))
  .get("/home/catalog", cacheFor(TTL.catalog), async (c) => c.json({ shelves: shelvesForApp(c, await viewer(c).homeCatalog()) }))
  .get("/home/profile", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ shelves: shelvesForApp(c, await viewer(c).homeProfile()) });
  })

  .get("/genres/:type", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ items: await viewer(c).genres(type) });
  })

  .get("/browse/:type/genre/:id", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ shelves: await viewer(c).genreShelves(type, intParam(c, "id")) });
  })

  // Episodes of the shows on this profile's list: the last week and the next month.
  .get("/calendar", cacheFor(TTL.calendar), async (c) => c.json({ items: await viewer(c).calendar() }))

  .get("/shows", cacheFor(TTL.catalog), async (c) => c.json({ shelves: await viewer(c).showsPage() }))
  .get("/anime/categories", cacheFor(TTL.catalog), (c) => c.json({ items: viewer(c).animeCategories() }))

  .get("/anime", cacheFor(TTL.catalog), async (c) => {
    const category = c.req.query("category") || undefined;
    if (category && !viewer(c).animeCategories().some((x) => x.id === category)) throw new HTTPException(400, { message: "Unknown anime category" });
    return c.json({ shelves: shelvesForApp(c, await viewer(c).animePage(category)) });
  })

  // One of the Anime tab's lists in full, for its rail's "›".
  .get("/anime/list/:id", cacheFor(TTL.catalog), async (c) => {
    const list = await viewer(c).animeList(c.req.param("id"));
    if (!list) throw new HTTPException(404, { message: "Unknown anime list" });
    return c.json({ ...list, items: forApp(c, list.items) });
  })

  .get("/person/:id", cacheFor(TTL.catalog), async (c) => c.json(await viewer(c).person(intParam(c, "id"))))

  .get("/browse/:type/:list", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    const list = z.enum(["trending", "popular", "topRated", "library"]).parse(c.req.param("list"));
    return c.json({ items: await viewer(c).browse(type, list) });
  })

  .get("/search", cacheFor(TTL.search), async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ items: [] });
    return c.json({ items: await viewer(c).search(q) });
  })

  .get("/titles/movie/:id", cacheFor(TTL.title), async (c) => c.json(await viewer(c).movie(intParam(c, "id"))))
  .get("/titles/show/:id", cacheFor(TTL.title), async (c) => c.json(await viewer(c).show(intParam(c, "id"))))
  .get("/titles/show/:id/seasons/:season", cacheFor(TTL.title), async (c) => c.json(await viewer(c).season(intParam(c, "id"), intParam(c, "season"))))
  // The same pages by ref ("tmdb:show:1399"); one segment fewer, so they never clash with the above.
  .get("/titles/:ref", cacheFor(TTL.title), async (c) => c.json(await viewer(c).title(refParam(c.req.param("ref")))))
  .get("/titles/:ref/seasons/:season", cacheFor(TTL.title), async (c) => c.json(await viewer(c).titleSeason(refParam(c.req.param("ref")), intParam(c, "season"))))

  // Library sources are instant; `discover=1` adds releases from scrapers (a few seconds).
  // The title is `ref`, or as older apps send it, `mediaType` and `tmdbId`.
  .get("/sources", async (c) => {
    const refText = c.req.query("ref");
    let title: Pick<TitleTarget, "source" | "mediaType" | "titleId">;
    if (refText !== undefined) {
      const ref = refParam(refText);
      title = { source: ref.source, mediaType: ref.type === "movie" ? "movie" : "episode", titleId: ref.id };
    } else {
      const mediaType = z.enum(["movie", "episode"]).parse(c.req.query("mediaType"));
      const tmdbId = optionalInt(c.req.query("tmdbId"));
      if (tmdbId === undefined) throw new HTTPException(400, { message: "tmdbId is required" });
      title = { source: "tmdb", mediaType, titleId: tmdbId };
    }
    const season = optionalInt(c.req.query("season"));
    const episode = optionalInt(c.req.query("episode"));
    if (title.mediaType === "episode" && (season === undefined || episode === undefined)) throw new HTTPException(400, { message: "season and episode are required for episodes" });
    const target: TitleTarget = { ...title, season, episode };
    const items = await viewer(c).sources(target);
    if (c.req.query("discover") === "1") {
      items.push(...(await viewer(c).discover(target)));
    }
    return c.json({ items });
  })

  .post("/play", async (c) => {
    const req = toTarget(await body(c, z.object({ ...targetFields, ...prepareFields, startMs: z.number().min(0).optional() })));
    return needsProbe(c, () => viewer(c).play(req));
  })

  // A file to download and watch offline (iPhone and iPad): its link and how to play it.
  .post("/downloads", async (c) => {
    const req = toTarget(await body(c, z.object({ ...targetFields, ...prepareFields })));
    return needsProbe(c, () => viewer(c).prepareDownload(req));
  })

  // A fresh link for a download whose link expired.
  .post("/files/:id/link", async (c) => {
    const id = intParam(c, "id");
    const url = await viewer(c).fileLink(id);
    return c.json({ url: url ?? `/api/files/${id}/content` });
  })

  // A file on this server's disk, for downloading (TorBox files download from TorBox).
  .get("/files/:id/content", async (c) => {
    const path = await viewer(c).localPath(intParam(c, "id"));
    if (!path) throw new HTTPException(404, { message: "No such file" });
    return serveRange(path, c.req.header("range"));
  })

  // Media info the app read from a file (see NeedsProbeError): codecs, tracks, length.
  .post("/files/:id/probe", async (c) => {
    const info = await body(c, mediaInfoSchema);
    if (!(await viewer(c).acceptProbe(intParam(c, "id"), info))) throw new HTTPException(404, { message: "No such file" });
    return c.json({ ok: true });
  })

  // A TorBox link expired mid-play (device and direct play fetch it themselves).
  .post("/play/:sessionId/link", async (c) => {
    const url = await viewer(c).refreshPlayLink(c.req.param("sessionId"));
    if (!url) throw new HTTPException(404, { message: "No such session" });
    return c.json({ url });
  })

  .delete("/play/:sessionId", async (c) => {
    await viewer(c).stopPlay(c.req.param("sessionId"));
    return c.json({ ok: true });
  })

  .post("/progress", async (c) => {
    const input = toTarget(await body(c, z.object({ ...targetFields, positionMs: z.number().min(0), durationMs: z.number().min(0), sessionId: z.string().optional() })));
    if (input.sessionId) await viewer(c).touchPlay(input.sessionId);
    const row = await c.var.services.progress.record(userOf(c), input, input.positionMs, input.durationMs);
    return c.json({ positionMs: row.positionMs, durationMs: row.durationMs, completed: row.completed });
  })

  .post("/watched", async (c) => {
    const input = toTarget(await body(c, z.object({ ...targetFields, watched: z.boolean() })));
    await c.var.services.progress.setWatched(userOf(c), input, input.watched);
    return c.json({ ok: true });
  })

  // Off Continue Watching / Next Up until it's watched again; progress is kept.
  .delete("/continue/:ref", async (c) => {
    await c.var.services.progress.hideFromContinue(userOf(c), refParam(c.req.param("ref")));
    return c.json({ ok: true });
  })
  // The same, as older apps ask (TMDB's id).
  .delete("/continue/:type/:tmdbId", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    await c.var.services.progress.hideFromContinue(userOf(c), tmdbRef(type, intParam(c, "tmdbId")));
    return c.json({ ok: true });
  })

  // My List on its own (it's also a shelf on /home).
  .get("/watchlist", async (c) => c.json({ items: forApp(c, await viewer(c).watchlist()) }))

  .put("/watchlist", async (c) => {
    const input = await body(c, z.object({ ref: z.string().optional(), type: z.enum(["movie", "show"]).optional(), tmdbId: z.number().int().optional(), on: z.boolean() }));
    const ref = toTitle(input);
    // Nothing above the profile's content limit goes on its list (taking it off is fine).
    await viewer(c).assertMayList(ref, input.on);
    await c.var.services.progress.setWatchlist(userOf(c), ref, input.on);
    return c.json({ ok: true });
  });
