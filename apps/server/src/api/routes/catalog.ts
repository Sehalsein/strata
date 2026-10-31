import { serveRange } from "./stream";
import { SEARCHES_PER_HOUSEHOLD } from "../../throttle";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, intParam, optionalInt, requireAuth, requireHousehold, userOf, type Env } from "../context";
import { capsSchema } from "../../playback/decide";
import { NeedsProbeError } from "../../playback/service";
import { mediaInfoSchema } from "../../media/probe";

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

/** What play and download both take, besides the title. */
const prepareFields = {
  candidateId: z.string().optional(),
  audioStreamIndex: z.number().int().optional(),
  preferMaxHeight: z.number().int().min(240).optional(),
  caps: capsSchema.default({}),
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

export const catalogRoutes = new Hono<Env>()
  .use(requireAuth, requireHousehold)

  .get("/home", async (c) => c.json({ shelves: await viewer(c).home() }))

  .get("/genres/:type", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ items: await viewer(c).genres(type) });
  })

  .get("/browse/:type/genre/:id", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    return c.json({ shelves: await viewer(c).genreShelves(type, intParam(c, "id")) });
  })

  // Episodes of the shows on this profile's list: the last week and the next month.
  .get("/calendar", async (c) => c.json({ items: await viewer(c).calendar() }))

  .get("/shows", async (c) => c.json({ shelves: await viewer(c).showsPage() }))
  .get("/anime/categories", (c) => c.json({ items: viewer(c).animeCategories() }))

  .get("/anime", async (c) => {
    const category = c.req.query("category") || undefined;
    if (category && !viewer(c).animeCategories().some((x) => x.id === category)) throw new HTTPException(400, { message: "Unknown anime category" });
    return c.json({ shelves: await viewer(c).animePage(category) });
  })

  .get("/person/:id", async (c) => c.json(await viewer(c).person(intParam(c, "id"))))

  .get("/browse/:type/:list", async (c) => {
    const type = z.enum(["movie", "show"]).parse(c.req.param("type"));
    const list = z.enum(["trending", "popular", "topRated", "library"]).parse(c.req.param("list"));
    return c.json({ items: await viewer(c).browse(type, list) });
  })

  .get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ items: [] });
    return c.json({ items: await viewer(c).search(q) });
  })

  .get("/titles/movie/:id", async (c) => c.json(await viewer(c).movie(intParam(c, "id"))))
  .get("/titles/show/:id", async (c) => c.json(await viewer(c).show(intParam(c, "id"))))
  .get("/titles/show/:id/seasons/:season", async (c) => c.json(await viewer(c).season(intParam(c, "id"), intParam(c, "season"))))

  // Library sources are instant; `discover=1` adds releases from scrapers (a few seconds).
  .get("/sources", async (c) => {
    const mediaType = z.enum(["movie", "episode"]).parse(c.req.query("mediaType"));
    const tmdbId = optionalInt(c.req.query("tmdbId"));
    if (tmdbId === undefined) throw new HTTPException(400, { message: "tmdbId is required" });
    const season = optionalInt(c.req.query("season"));
    const episode = optionalInt(c.req.query("episode"));
    if (mediaType === "episode" && (season === undefined || episode === undefined)) throw new HTTPException(400, { message: "season and episode are required for episodes" });
    const target = { mediaType, tmdbId, season, episode };
    const items = await viewer(c).sources(target);
    if (c.req.query("discover") === "1") {
      await c.var.services.throttle.spend(`searches:${c.var.household.organizationId}`, SEARCHES_PER_HOUSEHOLD, "This household has searched for releases a lot in the last hour.");
      items.push(...(await viewer(c).discover(target)));
    }
    return c.json({ items });
  })

  .post("/play", async (c) => {
    const req = await body(c, target.extend({ ...prepareFields, startMs: z.number().min(0).optional() }).refine(...episodeRule));
    return needsProbe(c, () => viewer(c).play(req));
  })

  // A file to download and watch offline (iPhone and iPad): its link and how to play it.
  .post("/downloads", async (c) => {
    const req = await body(c, target.extend(prepareFields).refine(...episodeRule));
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

  // My List on its own (it's also a shelf on /home).
  .get("/watchlist", async (c) => c.json({ items: await viewer(c).watchlist() }))

  .put("/watchlist", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), on: z.boolean() }));
    // Nothing above the profile's content limit goes on its list (taking it off is fine).
    await viewer(c).assertMayList(input.type, input.tmdbId, input.on);
    await c.var.services.progress.setWatchlist(userOf(c), input.type, input.tmdbId, input.on);
    return c.json({ ok: true });
  });
