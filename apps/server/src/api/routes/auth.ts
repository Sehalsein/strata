import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { profiles } from "../../db/schema";
import { API_VERSION, VERSION } from "../../version";
import { body, intParam, requireAdmin, requireAuth, type Env } from "../context";
import { CONTENT_LIMITS } from "../../catalog/contentRating";
import { allowJoin, isLocalRequest } from "../localNetwork";

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  deviceName: z.string().max(128).optional(),
});

const profileInput = z.object({
  name: z.string().trim().min(1).max(40),
  avatar: z.string().max(64).nullish(),
  /** 4–8 digits; null removes the PIN. */
  pin: z.string().regex(/^\d{4,8}$/).nullish(),
  /** Kids profiles start with the "kids" content limit. */
  isKids: z.boolean().optional(),
  contentLimit: z.enum(CONTENT_LIMITS).optional(),
});

const profileDto = (p: typeof profiles.$inferSelect) => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  hasPin: !!p.pinHash,
  isKids: p.isKids,
  contentLimit: p.contentLimit,
});

/** Shown on other devices (approval sheets, the dashboard), so plain words only. */
const deviceNameSchema = z.string().trim().regex(/^[\p{L}\p{N} .'’()-]{1,48}$/u, "Device names can only use letters, numbers and simple punctuation");

function canJoinLocally(c: Context<Env>): boolean {
  const s = c.var.services;
  return s.settings.get().localJoin && s.auth.hasAnyUser() && isLocalRequest(c);
}

export const authRoutes = new Hono<Env>()
  .get("/info", (c) => {
    const s = c.var.services;
    return c.json({
      name: "strata",
      serverName: s.settings.get().serverName,
      id: s.serverId,
      version: VERSION,
      apiVersion: API_VERSION,
      setupRequired: !s.auth.hasAnyUser(),
      /** True when this client may join without a password (see /auth/join). */
      localJoin: canJoinLocally(c),
    });
  })

  // Home-network devices skip the password and go straight to "Who's watching?";
  // profile PINs still apply. The session can watch but never administer.
  .post("/auth/join", async (c) => {
    const { deviceName } = await body(c, z.object({ deviceName: deviceNameSchema.optional() }).default({}));
    const s = c.var.services;
    const userId = canJoinLocally(c) ? s.auth.householdUserId() : undefined;
    if (!userId) throw new HTTPException(403, { message: "Sign in with your account to connect from outside your home network." });
    if (!allowJoin(c)) throw new HTTPException(429, { message: "Too many devices joined from here recently. Try again in a few minutes." });
    return c.json({ token: s.auth.issue(userId, deviceName ?? "Device", { viewerOnly: true }) });
  })

  // First-run: creates the admin and a first profile. Locked once any user exists.
  .post("/setup/admin", async (c) => {
    const s = c.var.services;
    const input = await body(c, credentials.extend({ password: z.string().min(8).max(256) }));
    if (s.auth.hasAnyUser()) throw new HTTPException(409, { message: "Setup already completed" });
    const user = await s.auth.createFirstAdmin(input.username, input.password);
    if (!user) throw new HTTPException(409, { message: "Setup already completed" });
    s.db.insert(profiles).values({ name: input.username }).run();
    return c.json({ token: s.auth.issue(user.id, input.deviceName ?? "Dashboard") });
  })

  .post("/auth/login", async (c) => {
    const input = await body(c, credentials);
    const token = await c.var.services.auth.login(input.username, input.password, input.deviceName);
    if (!token) throw new HTTPException(401, { message: "Wrong username or password" });
    return c.json({ token });
  })

  // Sign-in by code (QR on a TV). Start and poll are public: the TV isn't signed in yet.
  .post("/auth/device", async (c) => {
    const { deviceName } = await body(c, z.object({ deviceName: deviceNameSchema.optional() }).default({}));
    const link = c.var.services.deviceLinks.start(deviceName ?? "TV");
    if (!link) throw new HTTPException(429, { message: "Too many sign-in codes waiting. Try again in a few minutes." });
    return c.json({ ...link, pollIntervalMs: 2000 });
  })

  // POST so the poll token stays out of URLs and access logs.
  .post("/auth/device/poll", async (c) => {
    const { pollToken } = await body(c, z.object({ pollToken: z.string().min(1).max(128) }));
    return c.json(c.var.services.deviceLinks.poll(pollToken));
  })

  // The approving phone shows which device it's about to sign in before confirming.
  .get("/auth/device/:code", requireAuth, (c) => {
    const pending = c.var.services.deviceLinks.pending(c.req.param("code"));
    if (!pending) throw new HTTPException(404, { message: "That code has expired or was already used. Show a new one on the TV." });
    return c.json(pending);
  })

  .post("/auth/device/:code/approve", requireAuth, (c) => {
    const s = c.var.services;
    const userId = c.var.session.user.id;
    // The TV can watch but not administer, whoever approved it.
    const ok = s.deviceLinks.approve(c.req.param("code"), (deviceName) => s.auth.issue(userId, deviceName, { viewerOnly: true }));
    if (!ok) throw new HTTPException(404, { message: "That code has expired or was already used. Show a new one on the TV." });
    return c.json({ ok: true });
  })

  .post("/auth/logout", requireAuth, (c) => {
    c.var.services.auth.logout(c.var.session.tokenHash);
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, (c) => {
    const { user, profileId } = c.var.session;
    const profile = profileId ? c.var.services.db.select().from(profiles).where(eq(profiles.id, profileId)).get() : undefined;
    return c.json({ user, profile: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar, isKids: profile.isKids, contentLimit: profile.contentLimit } : null });
  })

  .get("/profiles", requireAuth, (c) => {
    const rows = c.var.services.db.select().from(profiles).orderBy(asc(profiles.id)).all();
    return c.json(rows.map(profileDto));
  })

  .post("/profiles/:id/select", requireAuth, async (c) => {
    const { pin } = await body(c, z.object({ pin: z.string().optional() }).default({}));
    const ok = await c.var.services.auth.selectProfile(c.var.session.tokenHash, intParam(c, "id"), pin);
    if (!ok) throw new HTTPException(403, { message: "Wrong PIN" });
    return c.json({ ok: true });
  })

  .post("/profiles", requireAuth, requireAdmin, async (c) => {
    const input = await body(c, profileInput);
    const pinHash = input.pin ? await Bun.password.hash(input.pin) : null;
    const isKids = input.isKids ?? false;
    const contentLimit = input.contentLimit ?? (isKids ? "kids" : "none");
    const row = c.var.services.db.insert(profiles).values({ name: input.name, avatar: input.avatar ?? null, pinHash, isKids, contentLimit }).returning().get();
    return c.json(profileDto(row), 201);
  })

  .patch("/profiles/:id", requireAuth, requireAdmin, async (c) => {
    const input = await body(c, profileInput.partial());
    const patch: Partial<typeof profiles.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.avatar !== undefined) patch.avatar = input.avatar;
    if (input.pin !== undefined) patch.pinHash = input.pin ? await Bun.password.hash(input.pin) : null;
    if (input.isKids !== undefined) patch.isKids = input.isKids;
    if (input.contentLimit !== undefined) patch.contentLimit = input.contentLimit;
    const row = c.var.services.db.update(profiles).set(patch).where(eq(profiles.id, intParam(c, "id"))).returning().get();
    if (!row) throw new HTTPException(404, { message: "No such profile" });
    return c.json(profileDto(row));
  })

  .delete("/profiles/:id", requireAuth, requireAdmin, (c) => {
    const db = c.var.services.db;
    if (db.select().from(profiles).all().length <= 1) throw new HTTPException(409, { message: "Can't delete the last profile" });
    db.delete(profiles).where(eq(profiles.id, intParam(c, "id"))).run();
    return c.json({ ok: true });
  });
