import { readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { recentLogs } from "../../log";
import { dashboardUrls } from "../../platform/network";
import { householdSettingsSchema, SECRET_KEYS, serverSettingsSchema, settingsSchema, type SecretKey } from "../../settings";
import { toCandidate } from "../../sources/resolver";
import { AddonError, addonBase, addonOrigin, type StreamAddon } from "../../sources/addons";
import { imageUrl, yearOf } from "../../catalog/tmdb";
import { formatRef, parseRef, targetRef, tmdbRef } from "../../catalog/ref";
import { API_VERSION, VERSION } from "../../version";
import { member, session as authSession, user } from "../../db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { homeNetworkMacs, isPrivateMac } from "../deviceInfo";
import { isLocalAddress } from "../localNetwork";
import type { PlaybackSession } from "../../playback/sessions";
import { KeyRejectedError, type Household } from "../../household";
import type { Services } from "../../services";
import { body, intParam, optionalInt, permissions, requireAuth, requireHousehold, requireHouseholdAdmin, requireServerAdmin, type Env } from "../context";
import { roleRank } from "../../auth/permissions";
import type { Context } from "hono";
import { runtime } from "#runtime";

/** Server-only actions (its keys, updates, logs, folders on its disk) also need the server admin. */
function assertServerAdmin(c: Context<Env>) {
  if (!permissions(c).administerServer) throw new HTTPException(403, { message: "Only the server's admin can do that" });
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
    const macs = rows.some((r) => r.ipAddress && /^\d+\.\d+\.\d+\.\d+$/.test(r.ipAddress) && isLocalAddress(r.ipAddress)) ? await homeNetworkMacs(c.var.services.profile) : new Map<string, string>();
    return c.json({
      items: rows.map(({ token, ...row }) => {
        const macAddress = (row.ipAddress && macs.get(row.ipAddress)) || null;
        return { ...row, viewerOnly: !!row.viewerOnly, isCurrent: token === current, macAddress, macIsPrivate: macAddress ? isPrivateMac(macAddress) : false };
      }),
    });
  })

  // Signs a device out of this household (it goes back to the sign-in screen).
  // A device of someone below the caller, their own, or one that only watches (a TV, a
  // home-network join); someone at or above them signs their own devices out.
  .delete("/devices/:id", async (c) => {
    const h = c.var.household;
    const db = c.var.services.db;
    const where = and(eq(authSession.id, c.req.param("id")), eq(authSession.activeOrganizationId, h.organizationId));
    const [device] = await db.select({ userId: authSession.userId, viewerOnly: authSession.viewerOnly }).from(authSession).where(where);
    if (!device) throw new HTTPException(404, { message: "No such device" });
    const me = c.var.session;
    if (device.userId !== me.user.id && !device.viewerOnly && !me.user.isServerAdmin) {
      const [theirs] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, h.organizationId), eq(member.userId, device.userId)));
      if (roleRank(theirs?.role) >= roleRank(me.role)) throw new HTTPException(403, { message: "Only they can sign that device out." });
    }
    await db.delete(authSession).where(where);
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
      mode: s.profile.mode,
      isServerAdmin: c.var.session.user.isServerAdmin,
      dataDir: s.profile.localState ? s.paths.root : null,
      uptimeMs: Date.now() - s.startedAt,
      ffmpeg: ff ? { version: ff.version, path: ff.ffmpeg, hwEncoder: ff.hwEncoder ?? null } : null,
      ffmpegSetup: s.ffmpegSetup(),
      tmdb: { configured: h.settingsStore.hasSecret("tmdbApiKey") },
      torbox: { configured: !!h.torbox() },
      jobs: await s.jobs.statusNow(),
      sessions: await Promise.all((await h.plays.list()).map(sessionDto)),
      library: await h.library.stats(),
      // Read-only: port and bind host come from the CLI/env (see README).
      network: { host: s.config.host, port: s.config.port, urls: dashboardUrls(s.config.host, s.config.port), bonjour: s.bonjour.active },
      update: (({ state, updateAvailable, latest, lastError }) => ({ state, updateAvailable, latestVersion: latest?.version ?? null, lastError }))(s.updater.status()),
    });
  })

  // The server's settings with the household's; secrets (the household's keys) only say
  // whether they're set.
  .get("/settings", (c) => {
    const household = c.var.household.settingsStore;
    const secrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, household.hasSecret(k)]));
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
    // Folders on the server's disk are the server admin's to hand out: a household's admin
    // could otherwise point theirs at another household's media, or anything else there.
    if ("mediaFolders" in householdPatch && JSON.stringify(householdPatch.mediaFolders) !== JSON.stringify(c.var.household.settings().mediaFolders)) assertServerAdmin(c);
    if (Object.keys(householdPatch).length) await c.var.services.households.updateSettings(c.var.household, householdPatch);
    return c.json({ settings: c.var.household.settings() });
  })

  // Keys are verified against the provider before they're stored.
  .put("/secrets/:key", async (c) => {
    const key = z.enum(SECRET_KEYS).parse(c.req.param("key")) as SecretKey;
    const { value } = await body(c, z.object({ value: z.string().trim().max(512).nullable() }));
    try {
      await c.var.household.setSecret(key, value);
    } catch (err) {
      if (err instanceof KeyRejectedError) throw new HTTPException(400, { message: err.message });
      throw err;
    }
    return c.json({ ok: true });
  })

  // The household's add-ons, without their URLs: those often hold a password or a key.
  .get("/addons", (c) => c.json({ items: c.var.household.addons().map(addonDto) }))

  // Adds an add-on by its manifest URL, once it's answered with a manifest that finds streams or subtitles.
  .post("/addons", async (c) => {
    const { url } = await body(c, z.object({ url: z.string().trim().min(1).max(2048) }));
    try {
      return c.json(addonDto(await c.var.household.addAddon(url, permissions(c).administerServer)), 201);
    } catch (err) {
      if (err instanceof AddonError) throw new HTTPException(400, { message: err.message });
      throw err;
    }
  })

  // Reads every manifest again; says which add-ons didn't answer.
  .post("/addons/refresh", async (c) => {
    const failed = await c.var.household.refreshAddons();
    return c.json({ items: c.var.household.addons().map(addonDto), failed });
  })

  // Turns an add-on on or off, moves it, or points it at another manifest URL (checked first).
  .patch("/addons/:id", async (c) => {
    const { url, ...patch } = await body(c, z.object({ enabled: z.boolean().optional(), index: z.number().int().min(0).optional(), url: z.string().trim().min(1).max(2048).optional() }));
    const h = c.var.household;
    let id = c.req.param("id");
    if (url !== undefined) {
      try {
        const replaced = await h.replaceAddon(id, url, permissions(c).administerServer);
        if (!replaced) throw new HTTPException(404, { message: "No such add-on" });
        id = replaced.id;
      } catch (err) {
        if (err instanceof AddonError) throw new HTTPException(400, { message: err.message });
        throw err;
      }
    }
    if (!(await h.updateAddon(id, patch))) throw new HTTPException(404, { message: "No such add-on" });
    return c.json({ items: h.addons().map(addonDto) });
  })

  // The add-on's own configure page. A redirect, so its URL (and the key in it) never sits
  // in the dashboard's data.
  .get("/addons/:id/configure", (c) => {
    const addon = c.var.household.addons().find((a) => a.id === c.req.param("id"));
    if (!addon) throw new HTTPException(404, { message: "No such add-on" });
    const target = new URL(`${addonBase(addon.url)}/configure`);
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new HTTPException(400, { message: "That add-on's address can't be opened" });
    // The path may hold the add-on's password: don't pass this page on as the referrer either.
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    return c.redirect(target.toString(), 302);
  })

  .delete("/addons", async (c) => {
    await c.var.household.removeAllAddons();
    return c.json({ ok: true });
  })

  .delete("/addons/:id", async (c) => {
    if (!(await c.var.household.removeAddon(c.req.param("id")))) throw new HTTPException(404, { message: "No such add-on" });
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
    if (name === "syncTorbox") runtime.background(h.syncTorbox());
    else if (name === "matchPending") runtime.background(h.library.matchPending());
    else {
      assertServerAdmin(c);
      if (!c.var.services.jobs.status().some((j) => j.name === name)) throw new HTTPException(404, { message: "No such job" });
      runtime.background(c.var.services.jobs.run(name));
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
        // `ref` and `source` are the file's own (its path, its release type: web, bluray…);
        // the title's are `titleRef` and `titleSource`.
        titleSource: f.source,
        titleRef: f.mediaType && f.titleId !== null ? formatRef(targetRef({ source: f.source, mediaType: f.mediaType, titleId: f.titleId })) : null,
        // TMDB's id, for TMDB titles (what the admin pages show and match by).
        tmdbId: f.source === "tmdb" ? f.titleId : null,
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

  // A title by its ref ("anilist:show:154587"), or a TMDB id and type (older dashboards).
  .post("/files/:id/match", async (c) => {
    const episodeFields = { season: z.number().int().min(0).optional(), episode: z.number().int().min(0).optional() };
    const input = await body(c, z.union([
      z.object({ ref: z.string().max(64), ...episodeFields }),
      z.object({ type: z.enum(["movie", "show"]), tmdbId: z.number().int(), ...episodeFields }),
    ]));
    const ref = "ref" in input ? parseRef(input.ref) : tmdbRef(input.type, input.tmdbId);
    if (!ref) throw new HTTPException(400, { message: "Not a title ref" });
    const id = intParam(c, "id");
    if (!await c.var.household.library.get(id)) throw new HTTPException(404, { message: "No such file" });
    try {
      await c.var.household.library.setManualMatch(id, ref, input.season, input.episode);
    } catch (err) {
      throw new HTTPException(400, { message: err instanceof Error ? err.message : String(err) });
    }
    return c.json({ ok: true });
  })

  // Play a file in the dashboard (to see what happens, live): a fresh link to it (TorBox
  // links carry the account key; only the household's admins get here) and what it holds.
  .post("/files/:id/play-link", async (c) => {
    const id = intParam(c, "id");
    const h = c.var.household;
    const file = await h.library.get(id);
    if (!file) throw new HTTPException(404, { message: "No such file" });
    let url: string;
    try {
      url = (await h.playback.fileLink(id)) ?? `/api/files/${id}/content`;
    } catch (err) {
      throw new HTTPException(502, { message: `Couldn't get a link: ${err instanceof Error ? err.message : String(err)}` });
    }
    const host = /^https?:/.test(url) ? new URL(url).host : null;
    return c.json({ url, host, provider: file.provider, name: file.name, size: file.size, info: file.probeJson ? JSON.parse(file.probeJson) : null });
  })

  .post("/files/:id/ignore", async (c) => {
    await c.var.household.library.ignore(intParam(c, "id"));
    return c.json({ ok: true });
  })

  .post("/files/:id/unignore", async (c) => {
    await c.var.household.library.unignore(intParam(c, "id"));
    runtime.background(c.var.household.library.matchPending());
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

  // AniList's anime for Fix Match (not adult titles).
  .get("/anilist/search", async (c) => {
    const q = c.req.query("q")?.trim().slice(0, 200);
    if (!q) return c.json({ items: [] });
    const results = await c.var.household.anilist.search(q).catch(() => {
      throw new HTTPException(502, { message: "AniList didn't answer; try again in a minute" });
    });
    return c.json({
      items: results.filter((m) => !m.isAdult).map((m) => {
        const ref = { source: "anilist" as const, type: m.format === "MOVIE" ? ("movie" as const) : ("show" as const), id: m.id };
        return {
          ref: formatRef(ref),
          anilistId: m.id,
          title: m.title.english?.trim() || m.title.romaji?.trim() || "",
          year: m.seasonYear ?? null,
          format: m.format ?? null,
          posterUrl: m.coverImage?.large ?? m.coverImage?.extraLarge ?? null,
          episodes: m.episodes ?? null,
        };
      }),
    });
  })

  .get("/sessions", async (c) => {
    const dto = await sessionDtoFor(c.var.services, c.var.household);
    return c.json({ items: await Promise.all((await c.var.household.plays.list()).map(dto)) });
  })
  .delete("/sessions/:id", async (c) => {
    if (!(await c.var.household.plays.stop(c.req.param("id")))) throw new HTTPException(404, { message: "No such play" });
    return c.json({ ok: true });
  })

  // Plays that failed or had to switch copies or file servers, newest first, as the apps
  // reported them: which copies were tried, the file servers that didn't answer, and why.
  .get("/play-reports", async (c) => {
    const h = c.var.household;
    const rows = await h.playReports.list(Math.min(optionalInt(c.req.query("limit")) ?? 50, 300));
    const names = new Map((await c.var.services.db.select({ id: user.id, name: user.name }).from(user)).map((u) => [u.id, u.name]));
    const titles = new Map<string, string | null>();
    const items = [];
    for (const r of rows) {
      const ref = targetRef({ source: r.source, mediaType: r.mediaType, titleId: r.titleId });
      const key = formatRef(ref);
      if (!titles.has(key)) titles.set(key, await h.library.titleOf(ref));
      items.push({
        id: r.id,
        at: r.createdAt,
        outcome: r.outcome,
        message: r.message,
        title: titles.get(key) ?? null,
        ref: key,
        mediaType: r.mediaType,
        season: r.season,
        episode: r.episode,
        userName: (r.userId && names.get(r.userId)) || null,
        deviceName: r.deviceName,
        deviceModel: r.deviceModel,
        appVersion: r.appVersion,
        location: r.location,
        attempts: JSON.parse(r.attemptsJson),
      });
    }
    return c.json({ items });
  })
  .delete("/play-reports", async (c) => {
    await c.var.household.playReports.clear();
    return c.json({ ok: true });
  });

/** The server admin's own pages: they don't need a household. */
export const serverAdminRoutes = new Hono<Env>()
  .use("/logs", requireAuth, requireServerAdmin)
  .use("/fs", requireAuth, requireServerAdmin)
  // Folder picker for the setup wizard. Admin-only; lists directories, never files.
  .get("/fs", async (c) => {
    if (!c.var.services.profile.localMedia) throw new HTTPException(404, { message: "The cloud server has no folders" });
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
  .get("/logs", (c) => {
    return c.json({ items: recentLogs(Math.min(optionalInt(c.req.query("limit")) ?? 200, 1000)) });
  });

async function sessionDtoFor(services: Services, h: Household) {
  const names = new Map((await services.db.select({ id: user.id, name: user.name }).from(user)).map((u) => [u.id, u.name]));
  return async (s: PlaybackSession) => ({
    id: s.id,
    userId: s.userId,
    userName: names.get(s.userId) ?? null,
    fileId: s.fileId,
    title: await h.library.titleOf(targetRef(s.target)),
    // As before sources (the web admin reads tmdbId: TMDB titles only), with source and ref.
    target: {
      source: s.target.source,
      ref: formatRef(targetRef(s.target)),
      mediaType: s.target.mediaType,
      tmdbId: s.target.source === "tmdb" ? s.target.titleId : null,
      season: s.target.season,
      episode: s.target.episode,
    },
    mode: s.plan.mode,
    reasons: s.plan.reasons,
    source: s.inputKind === "url" ? "torbox" : "local",
    startedAt: s.createdAt,
    lastAccessAt: s.lastAccessAt,
    paused: !!s.paused,
    error: s.error ?? null,
  });
}

/** What the dashboard sees of an add-on: never its URL's path, where its secrets are. */
function addonDto(a: StreamAddon) {
  const streams = a.resources.includes("stream");
  return {
    id: a.id,
    name: a.name,
    host: addonOrigin(a.url),
    enabled: a.enabled,
    kind: a.kind,
    configurable: a.configurable,
    resources: a.resources,
    anime: streams && (!a.idPrefixes || a.idPrefixes.some((p) => p.startsWith("kitsu"))),
    isDefault: a.id === "default",
  };
}
