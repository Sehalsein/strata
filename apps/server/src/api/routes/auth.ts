import { createHmac, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { member, organization, user } from "../../db/schema";
import { API_VERSION, VERSION } from "../../version";
import { body, requireAuth, requireHousehold, requireHouseholdAdmin, type Env } from "../context";
import { CONTENT_LIMITS } from "../../catalog/contentRating";
import { clientAddress, isLocalRequest, isLoopbackRequest } from "../localNetwork";
import { checkSetupCode, clearSetupCode } from "../../setupCode";
import { retryMessage, SETUP_PER_ADDRESS, STARTS_PER_ADDRESS } from "../../throttle";
import { isCloud } from "../../mode";
import { launchSecret } from "../../platform/launcher";

/**
 * Strata's own account routes, around Better Auth (mounted at /api/auth/*, which does
 * sign-in, households, members, invitations, TV codes and switching between saved
 * sign-ins): server info, first-run setup, the home server's password-less join, "me",
 * and the household's settings for each member (kids, content limit).
 */

const usernameSchema = z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Usernames can use letters, numbers, dots, dashes and underscores");

async function canJoinLocally(c: Context<Env>): Promise<boolean> {
  const s = c.var.services;
  return !isCloud && s.settings.get().localJoin && isLocalRequest(c) && (await s.hasAccounts());
}

/** Counts a password-less start (a home join) from this address; 429 past the limit. */
async function countStart(c: Context<Env>, what: string) {
  const key = `${what}:${clientAddress(c)}`;
  const throttle = c.var.services.throttle;
  const wait = await throttle.retryAfter(key);
  if (wait) throw new HTTPException(429, { message: retryMessage(wait) });
  await throttle.fail(key, STARTS_PER_ADDRESS);
}

/** A session for `userId` in `organizationId`, made by the server (home join). */
async function sessionFor(c: Context<Env>, userId: string, organizationId: string, viewerOnly: boolean): Promise<string> {
  const ctx = await c.var.services.auth.$context;
  const created = await ctx.internalAdapter.createSession(userId, false);
  // Made here rather than by Better Auth, so the device (for the Devices page) is set here too.
  await ctx.internalAdapter.updateSession(created.token, {
    activeOrganizationId: organizationId,
    viewerOnly,
    userAgent: c.req.header("user-agent") ?? null,
    ipAddress: clientAddress(c),
  });
  return created.token;
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
      /** "home" or "cloud" (stateless; no local folders or home-network join). */
      mode: isCloud ? "cloud" : "home",
      setupRequired: !(await s.hasAccounts()),
      /** Setup asks for the code from the server's log (not from the server's own machine). */
      setupCodeRequired: !isLoopbackRequest(c),
      /** True when this client may join without a password (see /join). */
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

  // First run: the server admin's account and their household. Needs the code the
  // server prints in its log, unless asked from the server's own machine.
  .post("/setup/admin", async (c) => {
    const s = c.var.services;
    const input = await body(
      c,
      z.object({
        username: usernameSchema,
        password: z.string().min(8).max(256),
        email: z.string().trim().email().max(254).optional(),
        householdName: z.string().trim().min(1).max(64).optional(),
        setupCode: z.string().max(32).optional(),
      }),
    );
    if (await s.hasAccounts()) throw new HTTPException(409, { message: "Setup already completed" });
    if (!isLoopbackRequest(c)) {
      const key = `setup:${clientAddress(c)}`;
      const wait = await s.throttle.retryAfter(key);
      if (wait) throw new HTTPException(429, { message: retryMessage(wait) });
      if (!(await checkSetupCode(s.db, input.setupCode ?? ""))) {
        await s.throttle.fail(key, SETUP_PER_ADDRESS);
        throw new HTTPException(403, { message: "That setup code isn't right. It's in the server's log, shown when it starts." });
      }
    }
    const api = s.auth.api;
    const email = (input.email ?? `${input.username.toLowerCase()}@users.strata`).toLowerCase();
    await api.createUser({ body: { email, password: input.password, name: input.username, role: "admin", data: { username: input.username } } });
    await clearSetupCode(s.db);
    const signIn = await api.signInUsername({ body: { username: input.username, password: input.password }, asResponse: true });
    const token = signIn.headers.get("set-auth-token");
    if (!token) throw new HTTPException(500, { message: "Couldn't sign in after setup" });
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const household = await api.createOrganization({
      headers,
      body: { name: input.householdName ?? `${input.username}'s home`, slug: `home-${randomBytes(4).toString("hex")}` },
    });
    await api.setActiveOrganization({ headers, body: { organizationId: household!.id } });
    return c.json({ token, householdId: household!.id });
  })

  // Home servers: devices on the home network sign in as a member they pick, without a
  // password, able to watch but not administer. Without `userId`: who can be picked.
  .post("/join", async (c) => {
    const input = await body(c, z.object({ userId: z.string().max(64).optional() }).default({}));
    if (!(await canJoinLocally(c))) throw new HTTPException(403, { message: "Sign in with your account to connect from outside your home network." });
    const db = c.var.services.db;
    const [home] = await db.select({ id: organization.id, name: organization.name }).from(organization).orderBy(asc(organization.createdAt)).limit(1);
    if (!home) throw new HTTPException(409, { message: "This server has no household yet." });
    const people = await db
      .select({ id: user.id, name: user.name, isKids: member.isKids })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, home.id))
      .orderBy(asc(member.createdAt));
    if (!input.userId) return c.json({ household: home, members: people });
    if (!people.some((p) => p.id === input.userId)) throw new HTTPException(404, { message: "No such member" });
    await countStart(c, "join");
    return c.json({ token: await sessionFor(c, input.userId, home.id, true) });
  })

  .get("/me", requireAuth, async (c) => {
    const { user: me, organizationId, viewerOnly } = c.var.session;
    const db = c.var.services.db;
    const [household] = organizationId
      ? await db
          .select({ id: organization.id, name: organization.name, role: member.role, contentLimit: member.contentLimit, isKids: member.isKids })
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, me.id)))
      : [];
    return c.json({ user: me, viewerOnly, household: household ?? null });
  })

  // A member's settings in this household (Better Auth keeps the member; these are Strata's).
  .patch("/household/members/:memberId", requireAuth, requireHousehold, requireHouseholdAdmin, async (c) => {
    const input = await body(c, z.object({ contentLimit: z.enum(CONTENT_LIMITS).optional(), isKids: z.boolean().optional() }));
    const patch: { contentLimit?: string; isKids?: boolean } = {};
    if (input.isKids !== undefined) {
      patch.isKids = input.isKids;
      // Kids accounts start with the kids' limit unless one is given.
      if (input.isKids && input.contentLimit === undefined) patch.contentLimit = "kids";
    }
    if (input.contentLimit !== undefined) patch.contentLimit = input.contentLimit;
    const [row] = await c.var.services.db
      .update(member)
      .set(patch)
      .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, c.var.household.organizationId)))
      .returning({ id: member.id, contentLimit: member.contentLimit, isKids: member.isKids });
    if (!row) throw new HTTPException(404, { message: "No such member" });
    return c.json(row);
  });
