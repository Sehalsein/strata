import { createHmac } from "node:crypto";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { profiles } from "../../db/schema";
import { API_VERSION, VERSION } from "../../version";
import { body, intParam, requireAdmin, requireAuth, type Env } from "../context";
import { CONTENT_LIMITS } from "../../catalog/contentRating";
import { clientAddress, isLocalRequest, isLoopbackRequest } from "../localNetwork";
import { AuthError } from "../../auth";
import { checkSetupCode, clearSetupCode } from "../../setupCode";
import { retryMessage, SETUP_PER_ADDRESS, STARTS_PER_ADDRESS } from "../../throttle";
import { isCloud } from "../../mode";
import { launchSecret } from "../../platform/launcher";

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

async function canJoinLocally(c: Context<Env>): Promise<boolean> {
  const s = c.var.services;
  return !isCloud && s.settings.get().localJoin && isLocalRequest(c) && (await s.auth.hasAnyUser());
}

/** Counts a password-less start (join, TV code) from this address; 429 past the limit. */
async function countStart(c: Context<Env>, what: string) {
  const key = `${what}:${clientAddress(c)}`;
  const throttle = c.var.services.throttle;
  const wait = await throttle.retryAfter(key);
  if (wait) throw new HTTPException(429, { message: retryMessage(wait) });
  await throttle.fail(key, STARTS_PER_ADDRESS);
}

function authFailure(err: unknown): never {
  if (err instanceof AuthError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

export const authRoutes = new Hono<Env>()
  .get("/info", async (c) => {
    const s = c.var.services;
    return c.json({
      name: "strata",
      serverName: s.settings.get().serverName,
      id: s.serverId,
      version: VERSION,
      apiVersion: API_VERSION,
      setupRequired: !(await s.auth.hasAnyUser()),
      /** Setup asks for the code from the server's log (not from the server's own machine). */
      setupCodeRequired: !isLoopbackRequest(c),
      /** True when this client may join without a password (see /auth/join). */
      localJoin: await canJoinLocally(c),
    });
  })

  // Strata.app proves the server answering is the one it started before opening the
  // dashboard: HMAC of the app's random challenge with a secret only the two share.
  // Only from this Mac (loopback), never proxied; the proof covers the port too.
  .get("/launcher/proof", (c) => {
    const secret = launchSecret();
    const challenge = c.req.header("x-strata-challenge") ?? "";
    if (!secret || !isLoopbackRequest(c) || !/^[0-9a-f]{32,128}$/.test(challenge)) throw new HTTPException(404, { message: "Not found" });
    const port = new URL(c.req.url).port || "80";
    return c.json({ proof: createHmac("sha256", secret).update(`${challenge}|${port}`).digest("hex") });
  })

  // Home-network devices skip the password and go straight to "Who's watching?";
  // profile PINs still apply. The session can watch but never administer.
  .post("/auth/join", async (c) => {
    const { deviceName } = await body(c, z.object({ deviceName: deviceNameSchema.optional() }).default({}));
    const s = c.var.services;
    const userId = (await canJoinLocally(c)) ? await s.auth.householdUserId() : undefined;
    if (!userId) throw new HTTPException(403, { message: "Sign in with your account to connect from outside your home network." });
    await countStart(c, "join");
    return c.json({ token: await s.auth.issue(userId, deviceName ?? "Device", { viewerOnly: true }) });
  })

  // First-run: creates the admin and a first profile. Locked once any user exists.
  .post("/setup/admin", async (c) => {
    const s = c.var.services;
    const input = await body(c, credentials.extend({ password: z.string().min(8).max(256), setupCode: z.string().max(32).optional() }));
    if (await s.auth.hasAnyUser()) throw new HTTPException(409, { message: "Setup already completed" });
    if (!isLoopbackRequest(c)) {
      const key = `setup:${clientAddress(c)}`;
      const wait = await s.throttle.retryAfter(key);
      if (wait) throw new HTTPException(429, { message: retryMessage(wait) });
      if (!(await checkSetupCode(s.db, input.setupCode ?? ""))) {
        await s.throttle.fail(key, SETUP_PER_ADDRESS);
        throw new HTTPException(403, { message: "That setup code isn't right. It's in the server's log, shown when it starts." });
      }
    }
    const user = await s.auth.createFirstAdmin(input.username, input.password);
    if (!user) throw new HTTPException(409, { message: "Setup already completed" });
    await clearSetupCode(s.db);
    await s.db.insert(profiles).values({ name: input.username });
    return c.json({ token: await s.auth.issue(user.id, input.deviceName ?? "Dashboard") });
  })

  .post("/auth/login", async (c) => {
    const input = await body(c, credentials);
    const token = await c.var.services.auth.login(input.username, input.password, clientAddress(c), input.deviceName).catch(authFailure);
    return c.json({ token });
  })

  // Signs out the account's other devices too.
  .post("/auth/password", requireAuth, async (c) => {
    const input = await body(c, z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256) }));
    const { session } = c.var;
    if (c.var.session.user.isAdmin === false && (await c.var.services.auth.isViewerOnly(session.tokenHash))) {
      throw new HTTPException(403, { message: "Sign in with your password to change it." });
    }
    const ok = await c.var.services.auth.changePassword(session.user.id, input.currentPassword, input.newPassword, session.tokenHash);
    if (!ok) throw new HTTPException(403, { message: "Your current password isn't right." });
    return c.json({ ok: true });
  })

  // Sign-in by code (QR on a TV). Start and poll are public: the TV isn't signed in yet.
  .post("/auth/device", async (c) => {
    const { deviceName } = await body(c, z.object({ deviceName: deviceNameSchema.optional() }).default({}));
    await countStart(c, "tvcode");
    const link = await c.var.services.deviceLinks.start(deviceName ?? "TV");
    if (!link) throw new HTTPException(429, { message: "Too many sign-in codes waiting. Try again in a few minutes." });
    return c.json({ ...link, pollIntervalMs: 2000 });
  })

  // POST so the poll token stays out of URLs and access logs.
  .post("/auth/device/poll", async (c) => {
    const { pollToken } = await body(c, z.object({ pollToken: z.string().min(1).max(128) }));
    return c.json(await c.var.services.deviceLinks.poll(pollToken));
  })

  // The approving phone shows which device it's about to sign in before confirming.
  .get("/auth/device/:code", requireAuth, async (c) => {
    const pending = await c.var.services.deviceLinks.pending(c.req.param("code"));
    if (!pending) throw new HTTPException(404, { message: "That code has expired or was already used. Show a new one on the TV." });
    return c.json(pending);
  })

  .post("/auth/device/:code/approve", requireAuth, async (c) => {
    const s = c.var.services;
    const userId = c.var.session.user.id;
    // The TV can watch but not administer, whoever approved it.
    const ok = await s.deviceLinks.approve(c.req.param("code"), (deviceName) => s.auth.issue(userId, deviceName, { viewerOnly: true }));
    if (!ok) throw new HTTPException(404, { message: "That code has expired or was already used. Show a new one on the TV." });
    return c.json({ ok: true });
  })

  .post("/auth/logout", requireAuth, async (c) => {
    await c.var.services.auth.logout(c.var.session.tokenHash);
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, async (c) => {
    const { user, profileId } = c.var.session;
    const profile = profileId ? (await c.var.services.db.select().from(profiles).where(eq(profiles.id, profileId)))[0] : undefined;
    return c.json({ user, profile: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar, isKids: profile.isKids, contentLimit: profile.contentLimit } : null });
  })

  .get("/profiles", requireAuth, async (c) => {
    const rows = await c.var.services.db.select().from(profiles).orderBy(asc(profiles.id));
    return c.json(rows.map(profileDto));
  })

  .post("/profiles/:id/select", requireAuth, async (c) => {
    const { pin } = await body(c, z.object({ pin: z.string().optional() }).default({}));
    const ok = await c.var.services.auth.selectProfile(c.var.session.tokenHash, intParam(c, "id"), pin).catch(authFailure);
    if (!ok) throw new HTTPException(404, { message: "No such profile" });
    return c.json({ ok: true });
  })

  .post("/profiles", requireAuth, requireAdmin, async (c) => {
    const input = await body(c, profileInput);
    const pinHash = input.pin ? await Bun.password.hash(input.pin) : null;
    const isKids = input.isKids ?? false;
    const contentLimit = input.contentLimit ?? (isKids ? "kids" : "none");
    const [row] = await c.var.services.db.insert(profiles).values({ name: input.name, avatar: input.avatar ?? null, pinHash, isKids, contentLimit }).returning();
    return c.json(profileDto(row!), 201);
  })

  .patch("/profiles/:id", requireAuth, requireAdmin, async (c) => {
    const input = await body(c, profileInput.partial());
    const patch: Partial<typeof profiles.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.avatar !== undefined) patch.avatar = input.avatar;
    if (input.pin !== undefined) patch.pinHash = input.pin ? await Bun.password.hash(input.pin) : null;
    if (input.isKids !== undefined) patch.isKids = input.isKids;
    if (input.contentLimit !== undefined) patch.contentLimit = input.contentLimit;
    const [row] = await c.var.services.db.update(profiles).set(patch).where(eq(profiles.id, intParam(c, "id"))).returning();
    if (!row) throw new HTTPException(404, { message: "No such profile" });
    return c.json(profileDto(row));
  })

  .delete("/profiles/:id", requireAuth, requireAdmin, async (c) => {
    const db = c.var.services.db;
    if ((await db.select({ id: profiles.id }).from(profiles)).length <= 1) throw new HTTPException(409, { message: "Can't delete the last profile" });
    await db.delete(profiles).where(eq(profiles.id, intParam(c, "id")));
    return c.json({ ok: true });
  });
