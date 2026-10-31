import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { recentLogs } from "../../log";
import { dashboardUrls } from "../../platform/network";
import { householdSettingsSchema, HOUSEHOLD_SECRET_KEYS, SECRET_KEYS, serverSettingsSchema, SERVER_SECRET_KEYS, settingsSchema, type SecretKey } from "../../settings";
import { TorboxClient } from "../../sources/torbox/client";
import { toCandidate } from "../../sources/resolver";
import { imageUrl, yearOf } from "../../catalog/tmdb";
import { API_VERSION, VERSION } from "../../version";
import { member, organization, session as authSession, user } from "../../db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { isCloud } from "../../mode";
import { homeNetworkMacs, isPrivateMac } from "../deviceInfo";
import { isLocalAddress } from "../localNetwork";
import type { PlaybackSession } from "../../playback/sessions";
import type { Household } from "../../household";
import type { Services } from "../../services";
import { body, intParam, optionalInt, requireAuth, requireHousehold, requireHouseholdAdmin, requireServerAdmin, type Env } from "../context";
import type { Context } from "hono";

/** Server-only actions (its keys, updates, logs, folders on its disk) also need the server admin. */
function assertServerAdmin(c: Context<Env>) {
  if (!c.var.session.user.isServerAdmin) throw new HTTPException(403, { message: "Only the server's admin can do that" });
}

/**
 * Running a household (its library, settings, TorBox key, plays), for its owner and
 * admins; the server's own settings and keys for the server admin. Devices, members and
 * invitations are Better Auth's (/api/auth/*).
 */
export const adminRoutes = new Hono<Env>()
  .use(requireAuth, requireHousehold, requireHouseholdAdmin)

  // Every device signed in to this household, with whose sign-in it is (tokens never leave).
  .get("/devices", async (c) => {
    const h = c.var.household;
    const rows = await c.var.services.db
      .select({
        id: authSession.id,
        userId: authSession.userId,
        userName: user.name,
        username: user.username,
        userAgent: authSession.userAgent,
        ipAddress: authSession.ipAddress,
        location: authSession.location,
        deviceName: authSession.deviceName,
        deviceModel: authSession.deviceModel,
        viewerOnly: authSession.viewerOnly,
        createdAt: authSession.createdAt,
        updatedAt: authSession.updatedAt,
        token: authSession.token,
      })
      .from(authSession)
      .innerJoin(user, eq(user.id, authSession.userId))
      .innerJoin(member, and(eq(member.userId, authSession.userId), eq(member.organizationId, h.organizationId)))
      .where(and(eq(authSession.activeOrganizationId, h.organizationId), gt(authSession.expiresAt, new Date())))
      .orderBy(desc(authSession.updatedAt));
    const current = c.var.session.token;
    // MACs only reach this server for devices on its own home network (its ARP table).
    const macs = rows.some((r) => r.ipAddress && /^\d+\.\d+\.\d+\.\d+$/.test(r.ipAddress) && isLocalAddress(r.ipAddress)) ? await homeNetworkMacs() : new Map<string, string>();
    return c.json({
      items: rows.map(({ token, ...row }) => {
        const macAddress = (row.ipAddress && macs.get(row.ipAddress)) || null;
        return { ...row, viewerOnly: !!row.viewerOnly, isCurrent: token === current, macAddress, macIsPrivate: macAddress ? isPrivateMac(macAddress) : false };
      }),
    });
  })

  // Signs a device out of this household (it goes back to the sign-in screen).
  .delete("/devices/:id", async (c) => {
    const h = c.var.household;
    const [row] = await c.var.services.db
      .delete(authSession)
      .where(and(eq(authSession.id, c.req.param("id")), eq(authSession.activeOrganizationId, h.organizationId)))
      .returning({ id: authSession.id });
    if (!row) throw new HTTPException(404, { message: "No such device" });
    return c.json({ ok: true });
  })

  .get("/status", async (c) => {
    const s = c.var.services;
    const h = c.var.household;
    const sessionDto = await sessionDtoFor(s, h);
    const ff = s.ffmpeg();
    return c.json({
      version: VERSION,
      apiVersion: API_VERSION,
      platform: `${platform()}-${process.arch}`,
      mode: isCloud ? "cloud" : "home",
      isServerAdmin: c.var.session.user.isServerAdmin,
      dataDir: isCloud ? null : s.paths.root,
      uptimeMs: Date.now() - s.startedAt,
      ffmpeg: ff ? { version: ff.version, path: ff.ffmpeg, hwEncoder: ff.hwEncoder ?? null } : null,
      ffmpegSetup: s.ffmpegSetup(),
      tmdb: { configured: s.settings.hasSecret("tmdbApiKey") },
      torbox: { configured: !!h.torbox() },
      jobs: s.jobs.status(),
      sessions: await Promise.all((await householdPlays(s, h)).map(sessionDto)),
      library: await h.library.stats(),
      // Read-only: port and bind host come from the CLI/env (see README).
      network: { host: s.config.host, port: s.config.port, urls: dashboardUrls(s.config.host, s.config.port), bonjour: s.bonjour.active },
      update: (({ state, updateAvailable, latest, lastError }) => ({ state, updateAvailable, latestVersion: latest?.version ?? null, lastError }))(s.updater.status()),
    });
  })

  // The server's settings with the household's; secrets only say whether they're set.
  .get("/settings", (c) => {
    const server = c.var.services.settings;
    const household = c.var.household.settingsStore;
    const secrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, (SERVER_SECRET_KEYS as readonly string[]).includes(k) ? server.hasSecret(k) : household.hasSecret(k)]));
    return c.json({ settings: c.var.household.settings(), secrets });
  })

  // Household settings for its admins; server settings for the server admin.
  .patch("/settings", async (c) => {
    const patch = await body(c, settingsSchema.partial());
    const pick = (keys: string[]) => Object.fromEntries(Object.entries(patch).filter(([k]) => keys.includes(k)));
    const serverPatch = pick(Object.keys(serverSettingsSchema.shape));
    const householdPatch = pick(Object.keys(householdSettingsSchema.shape));
    if (Object.keys(serverPatch).length) {
      assertServerAdmin(c);
      await c.var.services.settings.update(serverPatch);
    }
    if (Object.keys(householdPatch).length) await c.var.household.settingsStore.update(householdPatch);
    // A new language needs the household's catalog rebuilt in it.
    if ("language" in householdPatch) c.var.services.households.drop(c.var.household.organizationId);
    return c.json({ settings: c.var.household.settings() });
  })

  // Keys are verified against the provider before they're stored.
  .put("/secrets/:key", async (c) => {
    const s = c.var.services;
    const h = c.var.household;
    const key = z.enum(SECRET_KEYS).parse(c.req.param("key")) as SecretKey;
    const forHousehold = (HOUSEHOLD_SECRET_KEYS as readonly string[]).includes(key);
    if (!forHousehold) assertServerAdmin(c);
    const { value } = await body(c, z.object({ value: z.string().trim().max(512).nullable() }));
    if (value) {
      if (key === "tmdbApiKey" && !(await s.tmdb("en-US").testKey(value))) throw new HTTPException(400, { message: "TMDB rejected that key" });
      if (key === "omdbApiKey" && !(await s.omdb.testKey(value))) throw new HTTPException(400, { message: "OMDb rejected that key" });
      if (key === "torboxApiKey") {
        try {
          await new TorboxClient(value).me();
        } catch {
          throw new HTTPException(400, { message: "TorBox rejected that key" });
        }
      }
    }
    await (forHousehold ? h.settingsStore : s.settings).setSecret(key, value);
    if (value && key === "torboxApiKey") void syncNow(h);
    if (value && key === "tmdbApiKey") void s.jobs.run("matchPending");
    return c.json({ ok: true });
  })

  .get("/torbox/account", async (c) => {
    const client = c.var.household.torbox();
    if (!client) throw new HTTPException(404, { message: "TorBox is not configured" });
    const me = await client.me();
    return c.json({ email: me.email ?? null, plan: me.plan ?? null, premiumExpiresAt: me.premium_expires_at ?? null });
  })

  // This household's sync and matching; anything else runs server-wide (server admin).
  .post("/jobs/:name/run", (c) => {
    const name = c.req.param("name");
    const h = c.var.household;
    if (name === "syncTorbox") void syncNow(h);
    else if (name === "matchPending") void h.library.matchPending();
    else {
      assertServerAdmin(c);
      if (!c.var.services.jobs.status().some((j) => j.name === name)) throw new HTTPException(404, { message: "No such job" });
      void c.var.services.jobs.run(name);
    }
    return c.json({ ok: true }, 202);
  })

  .get("/files", async (c) => {
    const status = z.enum(["pending", "matched", "unmatched", "manual", "ignored"]).optional().parse(c.req.query("status") || undefined);
    const provider = z.enum(["local", "torbox"]).optional().parse(c.req.query("provider") || undefined);
    const limit = Math.min(optionalInt(c.req.query("limit")) ?? 100, 500);
    const offset = optionalInt(c.req.query("offset")) ?? 0;
    const filters = z.object({
      q: z.string().trim().max(200).optional(),
      searchIn: z.enum(["all", "title", "filename"]).optional(),
      mediaType: z.enum(["movie", "episode"]).optional(),
      accessed: z.enum(["yes", "no"]).optional(),
      sort: z.enum(["lastAccessed", "added", "title", "name", "size", "year"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    }).parse(c.req.query());
    const { rows, total } = await c.var.household.library.list({ status, provider, limit, offset, ...filters });
    return c.json({
      total,
      items: rows.map(({ file: f, title, year, lastAccessedAt, addedAt }) => ({
        ...toCandidate(f),
        ref: f.provider === "local" ? f.ref : undefined,
        matchStatus: f.matchStatus,
        mediaType: f.mediaType,
        tmdbId: f.tmdbId,
        season: f.season,
        episode: f.episode,
        title,
        year,
        lastAccessedAt,
        addedAt,
        parsed: f.parsedJson ? JSON.parse(f.parsedJson) : null,
      })),
    });
  })

  .post("/files/:id/match", async (c) => {
    const input = await body(c, z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), season: z.number().int().optional(), episode: z.number().int().optional() }));
    const id = intParam(c, "id");
    if (!await c.var.household.library.get(id)) throw new HTTPException(404, { message: "No such file" });
    await c.var.household.library.setManualMatch(id, input.type, input.tmdbId, input.season, input.episode);
    return c.json({ ok: true });
  })

  .post("/files/:id/ignore", async (c) => {
    await c.var.household.library.ignore(intParam(c, "id"));
    return c.json({ ok: true });
  })

  .post("/files/:id/unignore", async (c) => {
    await c.var.household.library.unignore(intParam(c, "id"));
    void c.var.household.library.matchPending();
    return c.json({ ok: true });
  })

  .get("/tmdb/search", async (c) => {
    const q = c.req.query("q")?.trim();
    const type = z.enum(["movie", "show"]).parse(c.req.query("type"));
    if (!q) return c.json({ items: [] });
    const tmdb = c.var.household.tmdb;
    const page = type === "movie" ? await tmdb.searchMovie(q) : await tmdb.searchShow(q);
    return c.json({
      items: page.results.slice(0, 20).map((r) => ({ tmdbId: r.id, title: r.title ?? r.name ?? "", year: yearOf(r.release_date ?? r.first_air_date), posterUrl: imageUrl(r.poster_path, "w185") })),
    });
  })

  .get("/sessions", async (c) => {
    const dto = await sessionDtoFor(c.var.services, c.var.household);
    return c.json({ items: await Promise.all((await householdPlays(c.var.services, c.var.household)).map(dto)) });
  })
  .delete("/sessions/:id", async (c) => {
    if (!(await householdPlays(c.var.services, c.var.household)).some((p) => p.id === c.req.param("id"))) throw new HTTPException(404, { message: "No such play" });
    await c.var.services.sessions.stop(c.req.param("id"));
    return c.json({ ok: true });
  });

/** The server admin's own pages: they don't need a household. */
export const serverAdminRoutes = new Hono<Env>()
  .use("/households", requireAuth, requireServerAdmin)
  .use("/logs", requireAuth, requireServerAdmin)
  .use("/fs", requireAuth, requireServerAdmin)
  // Folder picker for the setup wizard. Admin-only; lists directories, never files.
  .get("/fs", async (c) => {
    if (isCloud) throw new HTTPException(404, { message: "The cloud server has no folders" });
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
  // Households on this server (server admin): the dashboard's household list.
  .get("/households", async (c) => {
    const rows = await c.var.services.db.select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt }).from(organization);
    return c.json({ items: rows });
  })
  .get("/logs", (c) => {
    return c.json({ items: recentLogs(Math.min(optionalInt(c.req.query("limit")) ?? 200, 1000)) });
  });

/** Syncs one household's TorBox now (its key was just set, or someone asked). */
async function syncNow(h: Household) {
  const client = h.torbox();
  if (!client) return;
  const { syncTorbox } = await import("../../sources/torbox/sync");
  await syncTorbox(client, h.library, () => {});
  await h.library.matchPending();
}

async function householdPlays(services: Services, h: Household) {
  return (await services.sessions.list()).filter((s) => s.organizationId === h.organizationId);
}

async function sessionDtoFor(services: Services, h: Household) {
  const names = new Map((await services.db.select({ id: user.id, name: user.name }).from(user)).map((u) => [u.id, u.name]));
  return async (s: PlaybackSession) => ({
    id: s.id,
    userId: s.userId,
    userName: names.get(s.userId) ?? null,
    fileId: s.fileId,
    title: await h.library.titleOf(s.target.mediaType === "movie" ? "movie" : "show", s.target.tmdbId),
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
