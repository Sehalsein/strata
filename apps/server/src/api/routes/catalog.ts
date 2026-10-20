import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, intParam, optionalInt, profileOf, requireAuth, type Env } from "../context";
import { capsSchema } from "../../playback/decide";

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

export const catalogRoutes = new Hono<Env>()
  .use(requireAuth)

  .get("/home", async (c) => c.json({ shelves: await c.var.services.catalog.home(profileOf(c)) }))

  .get("/browse/:type/:list", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    const list = z.enum(["trending", "popular", "topRated", "library"]).parse(c.req.param("list"));
    return c.json({ items: await c.var.services.catalog.browse(type, list) });
  })

  .get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ items: [] });
    return c.json({ items: await c.var.services.catalog.search(q) });
  })

  .get("/titles/movie/:id", async (c) => c.json(await c.var.services.catalog.movie(profileOf(c), intParam(c, "id"))))
  .get("/titles/show/:id", async (c) => c.json(await c.var.services.catalog.show(profileOf(c), intParam(c, "id"))))
  .get("/titles/show/:id/seasons/:season", async (c) => c.json(await c.var.services.catalog.season(profileOf(c), intParam(c, "id"), intParam(c, "season"))))

  .get("/sources", (c) => {
    const mediaType = z.enum(["movie", "episode"]).parse(c.req.query("mediaType"));
    const tmdbId = optionalInt(c.req.query("tmdbId"));
    if (tmdbId === undefined) throw new HTTPException(400, { message: "tmdbId is required" });
    return c.json({ items: c.var.services.catalog.sources(mediaType, tmdbId, optionalInt(c.req.query("season")), optionalInt(c.req.query("episode"))) });
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

  .put("/watchlist", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), on: z.boolean() }));
    c.var.services.progress.setWatchlist(profileOf(c), input.type, input.tmdbId, input.on);
    return c.json({ ok: true });
  });
