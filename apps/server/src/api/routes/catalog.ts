import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, cacheFor, DAY, HOUR, intParam, optionalInt, profileOf, requireAuth, type Env } from "../context";
import { capsSchema } from "../../playback/decide";
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
  const profileId = profileOf(c);
  const filtered = await Promise.all(shelves.map(async (shelf) => ({ ...shelf, items: await c.var.services.content.filter(profileId, shelf.items) })));
  return filtered.filter((shelf) => shelf.items.length > 0);
}

// How long the apps keep each answer (see cacheFor). Catalog lists and title pages barely
// change; the calendar follows the profile's list, which the apps drop themselves when they
// change it. Home's own rails (Continue Watching, My List) aren't kept by the apps at all:
// the server keeps them until they change.
const TTL = { catalog: DAY, title: DAY, calendar: 6 * HOUR, search: HOUR } as const;

export const catalogRoutes = new Hono<Env>()
  .use(requireAuth)

  // Both parts at once, for apps that don't ask for them separately.
  .get("/home", async (c) => c.json({ shelves: await allowedShelves(c, await c.var.services.catalog.home(profileOf(c))) }))
  .get("/home/catalog", cacheFor(TTL.catalog), async (c) => c.json({ shelves: await allowedShelves(c, await c.var.services.catalog.homeCatalog()) }))
  .get("/home/profile", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ shelves: await allowedShelves(c, await c.var.services.catalog.homeProfile(profileOf(c))) });
  })

  .get("/genres/:type", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ items: await c.var.services.catalog.genres(type) });
  })

  .get("/browse/:type/genre/:id", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ shelves: await allowedShelves(c, await c.var.services.catalog.genreShelves(type, intParam(c, "id"))) });
  })

  // Episodes of the shows on this profile's list: the last week and the next month.
  .get("/calendar", cacheFor(TTL.calendar), async (c) => c.json({ items: await c.var.services.calendar.episodes(profileOf(c)) }))

  .get("/anime/categories", cacheFor(TTL.catalog), (c) => c.json({ items: c.var.services.catalog.animeCategories() }))

  .get("/anime", cacheFor(TTL.catalog), async (c) => {
    const category = c.req.query("category") || undefined;
    if (category && !c.var.services.catalog.animeCategories().some((x) => x.id === category)) throw new HTTPException(400, { message: "Unknown anime category" });
    return c.json({ shelves: await allowedShelves(c, await c.var.services.catalog.animePage(category)) });
  })

  .get("/person/:id", cacheFor(TTL.catalog), async (c) => {
    const person = await c.var.services.catalog.person(intParam(c, "id"));
    const content = c.var.services.content;
    const profileId = profileOf(c);
    return c.json({ ...person, movies: await content.filter(profileId, person.movies), shows: await content.filter(profileId, person.shows) });
  })

  .get("/browse/:type/:list", cacheFor(TTL.catalog), async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    const list = z.enum(["trending", "popular", "topRated", "library"]).parse(c.req.param("list"));
    return c.json({ items: await c.var.services.content.filter(profileOf(c), await c.var.services.catalog.browse(type, list)) });
  })

  .get("/search", cacheFor(TTL.search), async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ items: [] });
    return c.json({ items: await c.var.services.content.filter(profileOf(c), await c.var.services.catalog.search(q)) });
  })

  .get("/titles/movie/:id", cacheFor(TTL.title), async (c) => {
    const { catalog, content } = c.var.services;
    const [profileId, id] = [profileOf(c), intParam(c, "id")];
    await content.assertAllowed(profileId, "movie", id);
    const movie = await catalog.movie(profileId, id);
    return c.json({ ...movie, recommendations: await content.filter(profileId, movie.recommendations) });
  })
  .get("/titles/show/:id", cacheFor(TTL.title), async (c) => {
    const { catalog, content } = c.var.services;
    const [profileId, id] = [profileOf(c), intParam(c, "id")];
    await content.assertAllowed(profileId, "show", id);
    const show = await catalog.show(profileId, id);
    return c.json({ ...show, recommendations: await content.filter(profileId, show.recommendations) });
  })
  .get("/titles/show/:id/seasons/:season", cacheFor(TTL.title), async (c) => {
    const [profileId, id] = [profileOf(c), intParam(c, "id")];
    await c.var.services.content.assertAllowed(profileId, "show", id);
    return c.json(await c.var.services.catalog.season(profileId, id, intParam(c, "season")));
  })

  // Library sources are instant; `discover=1` adds releases from scrapers (a few seconds).
  .get("/sources", async (c) => {
    const mediaType = z.enum(["movie", "episode"]).parse(c.req.query("mediaType"));
    const tmdbId = optionalInt(c.req.query("tmdbId"));
    if (tmdbId === undefined) throw new HTTPException(400, { message: "tmdbId is required" });
    const season = optionalInt(c.req.query("season"));
    const episode = optionalInt(c.req.query("episode"));
    if (mediaType === "episode" && (season === undefined || episode === undefined)) throw new HTTPException(400, { message: "season and episode are required for episodes" });
    await c.var.services.content.assertAllowed(profileOf(c), mediaType === "movie" ? "movie" : "show", tmdbId);
    const items = c.var.services.catalog.sources(mediaType, tmdbId, season, episode);
    if (c.req.query("discover") === "1") items.push(...(await c.var.services.discovery.candidates({ mediaType, tmdbId, season, episode })));
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
    const profileId = profileOf(c);
    await c.var.services.content.assertAllowed(profileId, req.mediaType === "movie" ? "movie" : "show", req.tmdbId);
    return c.json(await c.var.services.playback.play({ userId: c.var.session.user.id, profileId }, req));
  })

  .delete("/play/:sessionId", (c) => {
    const s = c.var.services.sessions;
    const session = s.get(c.req.param("sessionId"));
    if (session && session.userId === c.var.session.user.id) s.stop(session.id);
    return c.json({ ok: true });
  })

  .post("/progress", async (c) => {
    const input = await body(c, target.extend({ positionMs: z.number().min(0), durationMs: z.number().min(0), sessionId: z.string().optional() }).refine(...episodeRule));
    if (input.sessionId) c.var.services.sessions.get(input.sessionId); // keeps the session alive
    const row = c.var.services.progress.record(profileOf(c), input, input.positionMs, input.durationMs);
    return c.json({ positionMs: row.positionMs, durationMs: row.durationMs, completed: row.completed });
  })

  .post("/watched", async (c) => {
    const input = await body(c, target.extend({ watched: z.boolean() }).refine(...episodeRule));
    c.var.services.progress.setWatched(profileOf(c), input, input.watched);
    return c.json({ ok: true });
  })

  // Off Continue Watching / Next Up until it's watched again; progress is kept.
  .delete("/continue/:type/:tmdbId", (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    c.var.services.progress.hideFromContinue(profileOf(c), type, intParam(c, "tmdbId"));
    return c.json({ ok: true });
  })

  .put("/watchlist", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), on: z.boolean() }));
    // Nothing above the profile's content limit goes on its list (taking it off is fine).
    if (input.on) await c.var.services.content.assertAllowed(profileOf(c), input.type, input.tmdbId);
    c.var.services.progress.setWatchlist(profileOf(c), input.type, input.tmdbId, input.on);
    return c.json({ ok: true });
  });
