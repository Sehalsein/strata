import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, deviceAuthorization, multiSession, organization, username } from "better-auth/plugins";
import type { Db } from "../db";
import * as schema from "../db/schema";
import { isCloud } from "../mode";
import { runtime } from "#runtime";

const DAY_S = 24 * 60 * 60;

/** The client id the Apple TV app sends when it asks for a sign-in code. */
export const TV_CLIENT_ID = "strata-apple-tv";

export interface AuthOptions {
  db: Db;
  /** The server's secret key (base64); Better Auth's signing secret is derived from it. */
  secretKey: Buffer;
  /** The address people reach the server at, when known (cloud). */
  baseURL?: string;
}

/**
 * Accounts, sign-in and households, by Better Auth:
 * - Accounts sign in with a username (or email) and password (Argon2id via the runtime:
 *   Bun's, or WASM on Workers).
 * - New people join by invitation (the organization plugin's): a household's admins
 *   invite an email with a role; signing up is only open to an email with a pending
 *   invitation, and accepting it adds them. Nothing here sends mail: the dashboard shows
 *   the link to pass on. A new household is made by the server admin, who then invites
 *   its owner.
 * - A household is an organization; its people are members with a role (owner, admin,
 *   member). Strata's own data (library, profiles, keys…) carries the household's id.
 * - The server admin (the account made with the setup code; Better Auth's admin plugin)
 *   runs the server: its keys, its households.
 * - The apps hold a bearer token; TVs sign in with a device code (RFC 8628) approved on
 *   a phone.
 * - Each person's account is their profile: a device keeps several sign-ins and switches
 *   between them (multi-session on the web; the apps keep each token). Sessions carry
 *   the active household and whether the device may only watch (joined without a
 *   password, a TV).
 * - Failed sign-ins are rate-limited in the database, shared by every server.
 */
export function createAuth(options: AuthOptions) {
  const db = options.db;
  return betterAuth({
    appName: "Strata",
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The hosted public demo shares one account: nobody may change it.
        if (process.env.STRATA_DEMO === "1" && /^\/(change-password|update-user|change-email|delete-user|set-password|admin\/|organization\/(create|update|delete|invite-member|remove-member|update-member-role|leave|cancel-invitation)$)/.test(ctx.path)) {
          throw new APIError("FORBIDDEN", { message: "The demo can't be changed." });
        }
        if (ctx.path !== "/sign-up/email") return;
        // The invitation's id is the proof (it's in the link; no mail is sent): an email
        // alone, which anyone might know, doesn't open sign-up.
        const body = (ctx.body ?? {}) as { email?: unknown; invitationId?: unknown };
        const email = String(body.email ?? "").toLowerCase();
        const [pending] = await db
          .select({ id: schema.invitation.id })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.id, String(body.invitationId ?? "")),
              eq(schema.invitation.email, email),
              eq(schema.invitation.status, "pending"),
              gt(schema.invitation.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (!pending) throw new APIError("FORBIDDEN", { message: "Signing up needs an invitation to a household. Ask its owner for one." });
      }),
      after: createAuthMiddleware(async (ctx) => {
        const adapter = ctx.context.internalAdapter;
        // The TV joins the household the approving phone is in: noted at approval…
        if (ctx.path === "/device/approve") {
          const userCode = String((ctx.body as { userCode?: unknown } | undefined)?.userCode ?? "").toUpperCase();
          const household = (ctx.context.session?.session as { activeOrganizationId?: string | null } | undefined)?.activeOrganizationId;
          const [code] = userCode ? await db.select({ deviceCode: schema.deviceCode.deviceCode }).from(schema.deviceCode).where(eq(schema.deviceCode.userCode, userCode)) : [];
          if (code && household) {
            await adapter.createVerificationValue({ identifier: `tv-household:${code.deviceCode}`, value: household, expiresAt: new Date(Date.now() + 15 * 60_000) });
          }
          return;
        }
        // …and applied when the TV picks up its sign-in, which can watch, never administer.
        if (ctx.path !== "/device/token") return;
        const token = (ctx.context.returned as { access_token?: string } | undefined)?.access_token;
        if (!token) return;
        const deviceCode = String((ctx.body as { device_code?: unknown } | undefined)?.device_code ?? "");
        const noted = deviceCode ? await adapter.findVerificationValue(`tv-household:${deviceCode}`) : null;
        await adapter.updateSession(token, { viewerOnly: true, ...(noted ? { activeOrganizationId: noted.value } : {}) });
        if (noted) await adapter.deleteVerificationByIdentifier(noted.identifier).catch(() => {});
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // A new sign-in opens in the account's household when it has just one.
          before: async (session) => {
            if ((session as { activeOrganizationId?: string | null }).activeOrganizationId) return;
            const rows = await db.select({ id: schema.member.organizationId }).from(schema.member).where(eq(schema.member.userId, session.userId)).limit(2);
            if (rows.length === 1) return { data: { ...session, activeOrganizationId: rows[0]!.id } };
          },
        },
      },
    },
    basePath: "/api/auth",
    baseURL: options.baseURL,
    secret: createHmac("sha256", options.secretKey).update("strata/better-auth").digest("base64"),
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        deviceCode: schema.deviceCode,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Open only to someone with a pending invitation (see `hooks`); the first account
      // comes from setup (routes/setup.ts).
      disableSignUp: false,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      password: {
        hash: (password) => runtime.hashPassword(password),
        verify: ({ hash, password }) => runtime.verifyPassword(password, hash),
      },
      // A new password signs the account out everywhere else.
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 90 * DAY_S,
      updateAge: DAY_S,
      additionalFields: {
        viewerOnly: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/username": { window: 15 * 60, max: 10 },
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/sign-up/email": { window: 15 * 60, max: 10 },
        "/change-password": { window: 15 * 60, max: 10 },
        "/device/code": { window: 10 * 60, max: 10 },
      },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      // The cloud server sits behind Cloudflare: the client's address is in its header.
      ipAddress: { ipAddressHeaders: isCloud ? ["cf-connecting-ip", "x-forwarded-for"] : [] },
    },
    plugins: [
      username({ minUsernameLength: 2, maxUsernameLength: 64 }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      organization({
        // Invitations last a week; the dashboard shows their link (no mail is sent), and
        // its id is what proves the invitee (see the sign-up hook), not a verified email.
        invitationExpiresIn: 7 * DAY_S,
        requireEmailVerificationOnInvitation: false,
        sendInvitationEmail: async () => {},
        // Households are made by the server admin (or setup), never by anyone signed in.
        allowUserToCreateOrganization: async (user) => (user as { role?: string }).role === "admin",
        creatorRole: "owner",
        membershipLimit: 50,
        schema: {
          member: {
            additionalFields: {
              contentLimit: { type: "string", required: false, defaultValue: "none", input: false },
              isKids: { type: "boolean", required: false, defaultValue: false, input: false },
            },
          },
        },
      }),
      multiSession({ maximumSessions: 8 }),
      bearer(),
      deviceAuthorization({
        verificationUri: "/link",
        expiresIn: "10m",
        interval: "2s",
        validateClient: (clientId) => clientId === TV_CLIENT_ID,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
