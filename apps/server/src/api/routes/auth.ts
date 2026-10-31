import { createHmac, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { account, continueHidden, member, organization, passkey, progress, session, user, watchlist } from "../../db/schema";
import { emailConfigured } from "../../email";
import { API_VERSION, VERSION } from "../../version";
import { body, requireAuth, requireHousehold, requireHouseholdAdmin, type Env } from "../context";
import { CONTENT_LIMITS } from "../../catalog/contentRating";
import { clientAddress, isLocalRequest, isLoopbackRequest } from "../localNetwork";
import { checkSetupCode, clearSetupCode } from "../../setupCode";
import { retryMessage, SETUP_PER_ADDRESS, STARTS_PER_ADDRESS } from "../../throttle";
import { isCloud } from "../../mode";
import { launchSecret } from "../../platform/launcher";
import { dashboardUrls } from "../../platform/network";
import { describeDevice } from "../deviceInfo";
import { assertMayManage, SIGN_IN_CODE_HEADER, SIGN_IN_CODE_SECONDS, signInCodeSecret, signInMethods, takeIssuedCode } from "../../auth/betterAuth";

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
  await ctx.internalAdapter.updateSession(created.token, { activeOrganizationId: organizationId, viewerOnly, ...describeDevice(c) });
  return created.token;
}

/**
 * The address a device should use for this server: the public one when set, else the one
 * this page was opened at, unless that's this machine itself (then its home-network address).
 */
function addressForDevices(c: Context<Env>): string {
  if (process.env.STRATA_PUBLIC_URL) return process.env.STRATA_PUBLIC_URL.replace(/\/+$/, "");
  const url = new URL(c.req.url);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && host !== "::1" && !host.startsWith("127.")) return url.origin;
  const { host: bind, port } = c.var.services.config;
  return dashboardUrls(bind, port).find((u) => !/\/\/(localhost|127\.|\[::1\])/.test(u)) ?? url.origin;
}

/**
 * Everything this server keeps about one person, as one JSON file (GDPR access and
 * portability): for the person themself, or for their household's admins answering a
 * request. Tokens and password hashes are never included.
 */
async function exportFor(c: Context<Env>, id: string): Promise<Response> {
  const db = c.var.services.db;
    const [person] = await db
    .select({ id: user.id, name: user.name, username: user.username, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt, role: user.role })
    .from(user)
    .where(eq(user.id, id));
  const memberships = await db
    .select({ household: organization.name, role: member.role, contentLimit: member.contentLimit, isKids: member.isKids, joinedAt: member.createdAt })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, id));
  const devices = await db
    .select({
      device: session.deviceName,
      model: session.deviceModel,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      location: session.location,
      signedInAt: session.createdAt,
      lastActiveAt: session.updatedAt,
      expiresAt: session.expiresAt,
      watchOnly: session.viewerOnly,
    })
    .from(session)
    .where(eq(session.userId, id));
  const signInMethods = await db.select({ provider: account.providerId, connectedAt: account.createdAt }).from(account).where(eq(account.userId, id));
  const savedPasskeys = await db.select({ name: passkey.name, createdAt: passkey.createdAt }).from(passkey).where(eq(passkey.userId, id));
  const watchProgress = await db.select().from(progress).where(eq(progress.userId, id));
  const myList = await db.select().from(watchlist).where(eq(watchlist.userId, id));
  const hiddenFromContinueWatching = await db.select().from(continueHidden).where(eq(continueHidden.userId, id));
  const strip = <T extends { userId?: unknown }>(rows: T[]) => rows.map(({ userId: _, ...r }) => r);
  const file = {
    exportedAt: new Date().toISOString(),
    server: c.var.services.settings.get().serverName,
    account: person,
    households: memberships,
    devices,
    signInMethods: signInMethods.map((m) => ({ ...m, provider: m.provider === "credential" ? "password" : m.provider })),
    passkeys: savedPasskeys,
    watchProgress: strip(watchProgress),
    myList: strip(myList),
    hiddenFromContinueWatching: strip(hiddenFromContinueWatching),
  };
  return new Response(JSON.stringify(file, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="strata-${person?.username ?? "account"}-data.json"` },
  });
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
      /** Ways in besides a password that this server is set up for (the sign-in page's buttons). */
      signIn: (({ google, passkeys }) => ({ google: !!google, passkey: !!passkeys, passwordReset: emailConfigured() }))(signInMethods()),
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
      .select({ id: user.id, name: user.name, image: user.image, isKids: member.isKids })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, home.id))
      .orderBy(asc(member.createdAt));
    if (!input.userId) return c.json({ household: home, members: people });
    if (!people.some((p) => p.id === input.userId)) throw new HTTPException(404, { message: "No such member" });
    await countStart(c, "join");
    return c.json({ token: await sessionFor(c, input.userId, home.id, true) });
  })

  // Everything kept about the signed-in person (the dashboard's Your data).
  .get("/me/export", requireAuth, (c) => exportFor(c, c.var.session.user.id))

  // Everything kept about a member, for their household's owner or admins (someone below
  // them, the same rule as resetting a password or deleting the account).
  .get("/household/members/:memberId/export", requireAuth, requireHousehold, requireHouseholdAdmin, async (c) => {
    const [row] = await c.var.services.db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, c.var.household.organizationId)));
    if (!row) throw new HTTPException(404, { message: "No such member" });
    const auth = c.var.services.auth;
    await assertMayManage(c.var.services.db, (headers) => auth.api.getSession({ headers }), c.req.raw.headers, row.userId).catch((err: unknown) => {
      throw new HTTPException(403, { message: err instanceof Error ? err.message : "Not allowed" });
    });
    return exportFor(c, row.userId);
  })

  // What the privacy page shows about this server: who runs it and what's switched on.
  .get("/privacy", async (c) => {
    const s = c.var.services;
    const { google, passkeys } = signInMethods();
    return c.json({
      serverName: s.settings.get().serverName,
      contact: process.env.STRATA_PRIVACY_CONTACT || null,
      operator: process.env.STRATA_OPERATOR || null,
      mode: isCloud ? "cloud" : "home",
      email: emailConfigured(),
      google: !!google,
      passkeys: !!passkeys,
    });
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
    return c.json({ user: me, viewerOnly, mustChangePassword: c.var.session.mustChangePassword, household: household ?? null });
  })

  // A member's sign-in QR code: a device that scans it signs in as them, in this household,
  // able to watch. Works once, for a minute; the dashboard asks for a new one every 30
  // seconds. For the household's admins, and for the member themself.
  .post("/household/members/:memberId/sign-in-code", requireAuth, requireHousehold, async (c) => {
    const s = c.var.services;
    const householdId = c.var.household.organizationId;
    const [row] = await s.db
      .select({ userId: member.userId, name: user.name, email: user.email, emailVerified: user.emailVerified })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, householdId)));
    if (!row) throw new HTTPException(404, { message: "No such member" });
    const me = c.var.session;
    const roles = (me.role ?? "").split(",");
    if (row.userId !== me.user.id && (me.viewerOnly || !(roles.includes("owner") || roles.includes("admin")))) {
      throw new HTTPException(403, { message: "Only the household's owner and admins can show someone else's code." });
    }
    // Better Auth wipes the password of an account whose email isn't marked confirmed when
    // a magic link signs it in. Strata never sends mail (people join by invitation link),
    // so its accounts count as confirmed.
    if (!row.emailVerified) await s.db.update(user).set({ emailVerified: true }).where(eq(user.id, row.userId));
    const captureId = crypto.randomUUID();
    // As a request to this server (Better Auth takes its address from it), marked as ours.
    const origin = new URL(c.req.url).origin;
    await s.auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, [SIGN_IN_CODE_HEADER]: signInCodeSecret },
        body: JSON.stringify({ email: row.email, metadata: { captureId, organizationId: householdId } }),
      }),
    );
    const token = takeIssuedCode(captureId);
    if (!token) throw new HTTPException(500, { message: "Couldn't make a sign-in code" });
    const server = addressForDevices(c);
    return c.json({
      name: row.name,
      server,
      expiresAt: new Date(Date.now() + SIGN_IN_CODE_SECONDS * 1000).toISOString(),
      refreshInSeconds: 30,
      /** What the QR code holds: the Strata apps (and the iPhone's camera) open it. */
      link: `strata://sign-in?${new URLSearchParams({ server, code: token })}`,
    });
  })

  // A member's settings in this household (Better Auth keeps the member; these are Strata's).
  .patch("/household/members/:memberId", requireAuth, requireHousehold, requireHouseholdAdmin, async (c) => {
    const input = await body(
      c,
      z.object({ name: z.string().trim().min(1).max(64).optional(), contentLimit: z.enum(CONTENT_LIMITS).optional(), isKids: z.boolean().optional() }),
    );
    const patch: { contentLimit?: string; isKids?: boolean } = {};
    if (input.isKids !== undefined) {
      patch.isKids = input.isKids;
      // Kids accounts start with the kids' limit unless one is given.
      if (input.isKids && input.contentLimit === undefined) patch.contentLimit = "kids";
    }
    if (input.contentLimit !== undefined) patch.contentLimit = input.contentLimit;
    const db = c.var.services.db;
    const where = and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, c.var.household.organizationId));
    const columns = { id: member.id, userId: member.userId, contentLimit: member.contentLimit, isKids: member.isKids };
    const [row] = Object.keys(patch).length ? await db.update(member).set(patch).where(where).returning(columns) : await db.select(columns).from(member).where(where);
    if (!row) throw new HTTPException(404, { message: "No such member" });
    // The name is the person's account's: it changes everywhere they're signed in.
    let name: string | undefined;
    if (input.name !== undefined) {
      const ctx = await c.var.services.auth.$context;
      name = (await ctx.internalAdapter.updateUser(row.userId, { name: input.name }))?.name ?? input.name;
    }
    return c.json({ id: row.id, contentLimit: row.contentLimit, isKids: row.isKids, ...(name !== undefined ? { name } : {}) });
  });
