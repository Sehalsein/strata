import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { recentLogs } from "../../log";
import { dashboardUrls } from "../../platform/network";
import { settingsSchema, SECRET_KEYS, type SecretKey } from "../../settings";
import { TorboxClient } from "../../sources/torbox/client";
import { toCandidate } from "../../sources/resolver";
import { imageUrl, yearOf } from "../../catalog/tmdb";
import { API_VERSION, VERSION } from "../../version";
import { profiles } from "../../db/schema";
import type { PlaybackSession } from "../../playback/sessions";
import type { Services } from "../../services";
import { body, intParam, optionalInt, requireAdmin, requireAuth, type Env } from "../context";

export const adminRoutes = new Hono<Env>()
  .use(requireAuth, requireAdmin)

  .get("/devices", (c) => {
    const current = c.var.session.tokenHash;
    return c.json({ items: c.var.services.auth.devices().map((d) => ({ ...d, isCurrent: d.id === current })) });
  })

  // Signs a device out: its token stops working and the app returns to Connect.
  .delete("/devices/:id", (c) => {
    const id = c.req.param("id");
    if (id === c.var.session.tokenHash) throw new HTTPException(409, { message: "That's this browser. Use Sign out instead." });
    if (!/^[0-9a-f]{64}$/.test(id)) throw new HTTPException(404, { message: "No such device" });
    c.var.services.auth.logout(id);
    return c.json({ ok: true });
  })

  .get("/status", async (c) => {
    const s = c.var.services;
    const sessionDto = sessionDtoFor(s);
    const ff = s.ffmpeg();
    return c.json({
      version: VERSION,
      apiVersion: API_VERSION,
      platform: `${platform()}-${process.arch}`,
      dataDir: s.paths.root,
      uptimeMs: Date.now() - s.startedAt,
      ffmpeg: ff ? { version: ff.version, path: ff.ffmpeg, hwEncoder: ff.hwEncoder ?? null } : null,
      tmdb: { configured: s.tmdb.configured },
      torbox: { configured: !!s.torbox() },
      jobs: s.jobs.status(),
      sessions: s.sessions.list().map(sessionDto),
      library: s.library.stats(),
      // Read-only: port and bind host come from the CLI/env (see README).
      network: { host: s.config.host, port: s.config.port, urls: dashboardUrls(s.config.host, s.config.port), bonjour: s.bonjour.active },
      update: (({ state, updateAvailable, latest, lastError }) => ({ state, updateAvailable, latestVersion: latest?.version ?? null, lastError }))(s.updater.status()),
    });
  })

  .get("/settings", (c) => {
    const s = c.var.services.settings;
    return c.json({ settings: s.get(), secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, s.hasSecret(k)])) });
  })

  .patch("/settings", async (c) => {
    const patch = await body(c, settingsSchema.partial());
    return c.json({ settings: c.var.services.settings.update(patch) });
  })

  // Keys are verified against the provider before they're stored.
  .put("/secrets/:key", async (c) => {
    const s = c.var.services;
    const key = z.enum(SECRET_KEYS).parse(c.req.param("key")) as SecretKey;
    const { value } = await body(c, z.object({ value: z.string().trim().max(512).nullable() }));
    if (value) {
      if (key === "tmdbApiKey" && !(await s.tmdb.testKey(value))) throw new HTTPException(400, { message: "TMDB rejected that key" });
      if (key === "torboxApiKey") {
        try {
          await new TorboxClient(value).me();
        } catch {
          throw new HTTPException(400, { message: "TorBox rejected that key" });
        }
      }
    }
    s.settings.setSecret(key, value);
    if (value && key === "torboxApiKey") void s.jobs.run("syncTorbox");
    if (value && key === "tmdbApiKey") void s.jobs.run("matchPending");
    return c.json({ ok: true });
  })

  .get("/torbox/account", async (c) => {
    const client = c.var.services.torbox();
    if (!client) throw new HTTPException(404, { message: "TorBox is not configured" });
    const me = await client.me();
    return c.json({ email: me.email ?? null, plan: me.plan ?? null, premiumExpiresAt: me.premium_expires_at ?? null });
  })

  // Folder picker for the setup wizard. Admin-only; lists directories, never files.
  .get("/fs", async (c) => {
    const path = resolve(c.req.query("path") || homedir());
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      throw new HTTPException(404, { message: `Can't read ${path}` });
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(path, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const shortcuts = [{ name: "Home", path: homedir() }];
    if (platform() === "darwin") shortcuts.push({ name: "Volumes", path: "/Volumes" });
    else shortcuts.push({ name: "/mnt", path: "/mnt" }, { name: "/media", path: "/media" });
    return c.json({ path, parent: dirname(path) === path ? null : dirname(path), dirs, shortcuts });
  })

  .post("/jobs/:name/run", (c) => {
    const name = c.req.param("name");
    if (!c.var.services.jobs.status().some((j) => j.name === name)) throw new HTTPException(404, { message: "No such job" });
    void c.var.services.jobs.run(name);
    return c.json({ ok: true }, 202);
  })

  .get("/files", (c) => {
    const status = z.enum(["pending", "matched", "unmatched", "manual", "ignored"]).optional().parse(c.req.query("status") || undefined);
    const provider = z.enum(["local", "torbox"]).optional().parse(c.req.query("provider") || undefined);
    const limit = Math.min(optionalInt(c.req.query("limit")) ?? 100, 500);
    const offset = optionalInt(c.req.query("offset")) ?? 0;
    const { rows, total } = c.var.services.library.list({ status, provider, limit, offset });
    return c.json({
      total,
      items: rows.map(({ file: f, title, year }) => ({
        ...toCandidate(f),
        ref: f.provider === "local" ? f.ref : undefined,
        matchStatus: f.matchStatus,
        mediaType: f.mediaType,
        tmdbId: f.tmdbId,
        season: f.season,
        episode: f.episode,
        title,
        year,
        parsed: f.parsedJson ? JSON.parse(f.parsedJson) : null,
      })),
    });
  })

  .post("/files/:id/match", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), season: z.number().int().optional(), episode: z.number().int().optional() }));
    const id = intParam(c, "id");
    if (!c.var.services.library.get(id)) throw new HTTPException(404, { message: "No such file" });
    await c.var.services.library.setManualMatch(id, input.type, input.tmdbId, input.season, input.episode);
    return c.json({ ok: true });
  })

  .post("/files/:id/ignore", (c) => {
    c.var.services.library.ignore(intParam(c, "id"));
    return c.json({ ok: true });
  })

  .post("/files/:id/unignore", (c) => {
    c.var.services.library.unignore(intParam(c, "id"));
    void c.var.services.jobs.run("matchPending");
    return c.json({ ok: true });
  })

  .get("/tmdb/search", async (c) => {
    const q = c.req.query("q")?.trim();
    const type = z.enum(["movie", "show"]).parse(c.req.query("type"));
    if (!q) return c.json({ items: [] });
    const tmdb = c.var.services.tmdb;
    const page = type === "movie" ? await tmdb.searchMovie(q) : await tmdb.searchShow(q);
    return c.json({
      items: page.results.slice(0, 20).map((r) => ({ tmdbId: r.id, title: r.title ?? r.name ?? "", year: yearOf(r.release_date ?? r.first_air_date), posterUrl: imageUrl(r.poster_path, "w185") })),
    });
  })

  .get("/sessions", (c) => c.json({ items: c.var.services.sessions.list().map(sessionDtoFor(c.var.services)) }))
  .delete("/sessions/:id", (c) => {
    c.var.services.sessions.stop(c.req.param("id"));
    return c.json({ ok: true });
  })

  .get("/logs", (c) => c.json({ items: recentLogs(Math.min(optionalInt(c.req.query("limit")) ?? 200, 1000)) }));

function sessionDtoFor(services: Services) {
  const profileNames = new Map(services.db.select({ id: profiles.id, name: profiles.name }).from(profiles).all().map((p) => [p.id, p.name]));
  return (s: PlaybackSession) => ({
    id: s.id,
    profileId: s.profileId,
    profileName: profileNames.get(s.profileId) ?? null,
    fileId: s.fileId,
    title: services.library.titleOf(s.target.mediaType === "movie" ? "movie" : "show", s.target.tmdbId),
    target: s.target,
    mode: s.plan.mode,
    reasons: s.plan.reasons,
    source: s.inputKind === "url" ? "torbox" : "local",
    startedAt: s.createdAt,
    lastAccessAt: s.lastAccessAt,
    paused: !!s.paused,
    error: s.error ?? null,
  });
}
