import { createHash, createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, deviceAuthorization, magicLink, multiSession, organization, username } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { Db } from "../db";
import * as schema from "../db/schema";
import { runtime } from "#runtime";

const DAY_S = 24 * 60 * 60;

/** The header api/app.ts puts the client's address in for Better Auth's rate limits. */
export const CLIENT_ADDRESS_HEADER = "x-strata-client-address";

/** The client id the Apple TV app sends when it asks for a sign-in code. */
export const TV_CLIENT_ID = "strata-apple-tv";

/** How long a sign-in QR code works; the dashboard shows a new one every 30 seconds. */
export const SIGN_IN_CODE_SECONDS = 60;

/** Where a sign-in code's household is noted until the code is used. */
const signInCodeNote = (token: string) => `sign-in-code:${createHash("sha256").update(token).digest("base64url")}`;

/**
 * Sign-in codes made in this process, by the id the caller passed: the magic-link plugin
 * hands its token to `sendMagicLink`, which keeps it here for the caller instead of
 * mailing it (nothing here sends mail).
 */
const issuedCodes = new Map<string, string>();

/** Takes the code `issueSignInCode`'s call to the plugin produced. */
/** Marks the server's own call for a code (a random secret, made per process). */
export const SIGN_IN_CODE_HEADER = "x-strata-sign-in-code";
export const signInCodeSecret = crypto.randomUUID();

export function takeIssuedCode(captureId: string): string | undefined {
  const token = issuedCodes.get(captureId);
  issuedCodes.delete(captureId);
  return token;
}

/**
 * The ways in besides a password, each on only when the server is set up for it, so a
 * home server shows neither:
 * - Google: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (redirect URI
 *   `<address>/api/auth/callback/google`).
 * - Passkeys: a public HTTPS address (STRATA_PUBLIC_URL); browsers only allow them on HTTPS.
 */
export function signInMethods() {
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } : null;
  let passkeys: { rpID: string; origin: string } | null = null;
  try {
    const url = process.env.STRATA_PUBLIC_URL ? new URL(process.env.STRATA_PUBLIC_URL) : null;
    if (url?.protocol === "https:") passkeys = { rpID: url.hostname, origin: url.origin };
  } catch {
    // Not a URL: no passkeys.
  }
  return { google, passkeys };
}

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
  const methods = signInMethods();
  return betterAuth({
    appName: "Strata",
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The hosted public demo shares one account: nobody may change it.
        if (process.env.STRATA_DEMO === "1" && /^\/(change-password|update-user|change-email|delete-user|set-password|admin\/|organization\/(create|update|delete|invite-member|remove-member|update-member-role|leave|cancel-invitation)$)/.test(ctx.path)) {
          throw new APIError("FORBIDDEN", { message: "The demo can't be changed." });
        }
        // Sign-in codes are only made by the server (api/routes/auth.ts, for a household's
        // admins or the member themself), never asked for from outside.
        if (ctx.path === "/sign-in/magic-link" && ctx.headers?.get(SIGN_IN_CODE_HEADER) !== signInCodeSecret) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
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
        // A sign-in code (a member's QR code) opens the household it was made in, to watch:
        // the device can't administer. A code for someone no longer in it signs nobody in.
        if (ctx.path === "/magic-link/verify") {
          const created = ctx.context.newSession;
          const token = String((ctx.query as { token?: unknown } | undefined)?.token ?? "");
          if (!created || !token) return;
          const noted = await adapter.findVerificationValue(signInCodeNote(token));
          if (noted) await adapter.deleteVerificationByIdentifier(noted.identifier).catch(() => {});
          const [stillMember] = noted
            ? await db.select({ id: schema.member.id }).from(schema.member).where(and(eq(schema.member.organizationId, noted.value), eq(schema.member.userId, created.user.id)))
            : [];
          if (!noted || !stillMember) {
            await adapter.deleteSession(created.session.token);
            throw new APIError("FORBIDDEN", { message: "That code is no longer valid. Ask for a new one." });
          }
          await adapter.updateSession(created.session.token, { activeOrganizationId: noted.value, viewerOnly: true });
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
        passkey: schema.passkey,
        rateLimit: schema.rateLimit,
      },
    }),
    // Google signs in only an account that connected it while signed in (Settings ›
    // Account): it never makes an account, nor joins one by matching email (many Strata
    // accounts have none), and the Google address needn't be the account's.
    socialProviders: methods.google ? { google: { ...methods.google, disableSignUp: true, disableImplicitSignUp: true } } : {},
    account: {
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
    },
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
        // What the device is and where it was last seen (api/deviceInfo.ts; kept current by requireAuth).
        location: { type: "string", required: false, input: false },
        deviceName: { type: "string", required: false, input: false },
        deviceModel: { type: "string", required: false, input: false },
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
      // Set by the app for every request here (api/app.ts): the client's address, from the
      // connection or, behind Cloudflare or a trusted proxy, its header.
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
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
      // Sign-in QR codes: a household's admin (or the member) shows a member's code in the
      // dashboard and a device scans it to sign in as them. Each code works once, for a
      // minute; the token goes back to the dashboard instead of by mail. Only existing
      // accounts can use one.
      magicLink({
        expiresIn: SIGN_IN_CODE_SECONDS,
        disableSignUp: true,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 30 },
        sendMagicLink: async ({ token, metadata }, ctx) => {
          const { captureId, organizationId } = (metadata ?? {}) as { captureId?: string; organizationId?: string };
          if (!captureId || !organizationId || !ctx) return;
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: signInCodeNote(token),
            value: organizationId,
            expiresAt: new Date(Date.now() + SIGN_IN_CODE_SECONDS * 1000),
          });
          issuedCodes.set(captureId, token);
        },
      }),
      multiSession({ maximumSessions: 8 }),
      ...(methods.passkeys ? [passkey({ rpID: methods.passkeys.rpID, rpName: "Strata", origin: methods.passkeys.origin })] : []),
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
