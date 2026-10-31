import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, intParam, optionalInt, requireAuth, requireHousehold, userOf, type Env } from "../context";
import { capsSchema } from "../../playback/decide";
import { NeedsProbeError } from "../../playback/service";
import { mediaInfoSchema } from "../../media/probe";
import type { Shelf } from "../../catalog/service";

const target = z.object({
  mediaType: z.enum(["movie", "episode"]),
  tmdbId: z.number().int(),
  season: z.number().int().min(0).optional(),
  episode: z.number().int().min(0).optional(),
});

const episodeRule = [
  (t: { mediaType: string; season?: number; episode?: number }) => t.mediaType === "movie" || (t.season !== undefined && t.episode !== undefined),
  { message: "season and episode are required for episodes" },
] as const;

/** Drops titles above the profile's content limit, and shelves left empty. */
async function allowedShelves(c: Context<Env>, shelves: Shelf[]): Promise<Shelf[]> {
  const userId = userOf(c);
  const filtered = await Promise.all(shelves.map(async (shelf) => ({ ...shelf, items: await c.var.household.content.filter(userId, shelf.items) })));
  return filtered.filter((shelf) => shelf.items.length > 0);
}

export const catalogRoutes = new Hono<Env>()
  .use(requireAuth, requireHousehold)

  .get("/home", async (c) => c.json({ shelves: await allowedShelves(c, await c.var.household.catalog.home(userOf(c))) }))

  .get("/genres/:type", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ items: await c.var.household.catalog.genres(type) });
  })

  .get("/browse/:type/genre/:id", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ shelves: await allowedShelves(c, await c.var.household.catalog.genreShelves(type, intParam(c, "id"))) });
  })

  // Episodes of the shows on this profile's list: the last week and the next month.
  .get("/calendar", async (c) => c.json({ items: await c.var.household.calendar.episodes(userOf(c)) }))

  .get("/shows", async (c) => c.json({ shelves: await allowedShelves(c, await c.var.household.catalog.showsPage()) }))
  .get("/anime/categories", (c) => c.json({ items: c.var.household.catalog.animeCategories() }))

  .get("/anime", async (c) => {
    const category = c.req.query("category") || undefined;
    if (category && !c.var.household.catalog.animeCategories().some((x) => x.id === category)) throw new HTTPException(400, { message: "Unknown anime category" });
    return c.json({ shelves: await allowedShelves(c, await c.var.household.catalog.animePage(category)) });
  })

  .get("/person/:id", async (c) => {
    const person = await c.var.household.catalog.person(intParam(c, "id"));
    const content = c.var.household.content;
    const userId = userOf(c);
    return c.json({ ...person, movies: await content.filter(userId, person.movies), shows: await content.filter(userId, person.shows) });
  })

  .get("/browse/:type/:list", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    const list = z.enum(["trending", "popular", "topRated", "library"]).parse(c.req.param("list"));
    return c.json({ items: await c.var.household.content.filter(userOf(c), await c.var.household.catalog.browse(type, list)) });
  })

  .get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ items: [] });
    return c.json({ items: await c.var.household.content.filter(userOf(c), await c.var.household.catalog.search(q)) });
  })

  .get("/titles/movie/:id", async (c) => {
    const { catalog, content } = c.var.household;
    const [userId, id] = [userOf(c), intParam(c, "id")];
    await content.assertAllowed(userId, "movie", id);
    const movie = await catalog.movie(userId, id);
    return c.json({ ...movie, recommendations: await content.filter(userId, movie.recommendations) });
  })
  .get("/titles/show/:id", async (c) => {
    const { catalog, content } = c.var.household;
    const [userId, id] = [userOf(c), intParam(c, "id")];
    await content.assertAllowed(userId, "show", id);
    const show = await catalog.show(userId, id);
    return c.json({ ...show, recommendations: await content.filter(userId, show.recommendations) });
  })
  .get("/titles/show/:id/seasons/:season", async (c) => {
    const [userId, id] = [userOf(c), intParam(c, "id")];
    await c.var.household.content.assertAllowed(userId, "show", id);
    return c.json(await c.var.household.catalog.season(userId, id, intParam(c, "season")));
  })

  // Library sources are instant; `discover=1` adds releases from scrapers (a few seconds).
  .get("/sources", async (c) => {
    const mediaType = z.enum(["movie", "episode"]).parse(c.req.query("mediaType"));
    const tmdbId = optionalInt(c.req.query("tmdbId"));
    if (tmdbId === undefined) throw new HTTPException(400, { message: "tmdbId is required" });
    const season = optionalInt(c.req.query("season"));
    const episode = optionalInt(c.req.query("episode"));
    if (mediaType === "episode" && (season === undefined || episode === undefined)) throw new HTTPException(400, { message: "season and episode are required for episodes" });
    await c.var.household.content.assertAllowed(userOf(c), mediaType === "movie" ? "movie" : "show", tmdbId);
    const items = await c.var.household.catalog.sources(mediaType, tmdbId, season, episode);
    if (c.req.query("discover") === "1") items.push(...(await c.var.household.discovery.candidates({ mediaType, tmdbId, season, episode })));
    return c.json({ items });
  })

  .post("/play", async (c) => {
    const req = await body(
      c,
      target
        .extend({
          candidateId: z.string().optional(),
          startMs: z.number().min(0).optional(),
          audioStreamIndex: z.number().int().optional(),
          caps: capsSchema.default({}),
        })
        .refine(...episodeRule),
    );
    const userId = userOf(c);
    await c.var.household.content.assertAllowed(userId, req.mediaType === "movie" ? "movie" : "show", req.tmdbId);
    try {
      return c.json(await c.var.household.playback.play({ userId }, req));
    } catch (err) {
      // The app reads the file's details itself, sends them, and asks again.
      if (err instanceof NeedsProbeError) return c.json({ needsProbe: { fileId: err.fileId, url: err.url } }, 428);
      throw err;
    }
  })

  // Media info the app read from a file (see NeedsProbeError): codecs, tracks, length.
  .post("/files/:id/probe", async (c) => {
    const info = await body(c, mediaInfoSchema);
    if (!(await c.var.household.playback.acceptProbe(intParam(c, "id"), info))) throw new HTTPException(404, { message: "No such file" });
    return c.json({ ok: true });
  })

  // A TorBox link expired mid-play (device and direct play fetch it themselves).
  .post("/play/:sessionId/link", async (c) => {
    const services = c.var.services;
    const session = await services.sessions.get(c.req.param("sessionId"));
    if (!session || session.userId !== c.var.session.user.id || session.organizationId !== c.var.household.organizationId) {
      throw new HTTPException(404, { message: "No such session" });
    }
    await c.var.household.playback.refreshLink(session);
    return c.json({ url: c.var.household.playback.handOff(session) });
  })

  .delete("/play/:sessionId", async (c) => {
    const s = c.var.services.sessions;
    const session = await s.get(c.req.param("sessionId"));
    if (session && session.userId === c.var.session.user.id) await s.stop(session.id);
    return c.json({ ok: true });
  })

  .post("/progress", async (c) => {
    const input = await body(c, target.extend({ positionMs: z.number().min(0), durationMs: z.number().min(0), sessionId: z.string().optional() }).refine(...episodeRule));
    if (input.sessionId) await c.var.services.sessions.get(input.sessionId); // keeps the session alive
    const row = await c.var.services.progress.record(userOf(c), input, input.positionMs, input.durationMs);
    return c.json({ positionMs: row.positionMs, durationMs: row.durationMs, completed: row.completed });
  })

  .post("/watched", async (c) => {
    const input = await body(c, target.extend({ watched: z.boolean() }).refine(...episodeRule));
    await c.var.services.progress.setWatched(userOf(c), input, input.watched);
    return c.json({ ok: true });
  })

  // Off Continue Watching / Next Up until it's watched again; progress is kept.
  .delete("/continue/:type/:tmdbId", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    await c.var.services.progress.hideFromContinue(userOf(c), type, intParam(c, "tmdbId"));
    return c.json({ ok: true });
  })

  .put("/watchlist", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), on: z.boolean() }));
    // Nothing above the profile's content limit goes on its list (taking it off is fine).
    if (input.on) await c.var.household.content.assertAllowed(userOf(c), input.type, input.tmdbId);
    await c.var.services.progress.setWatchlist(userOf(c), input.type, input.tmdbId, input.on);
    return c.json({ ok: true });
  });
