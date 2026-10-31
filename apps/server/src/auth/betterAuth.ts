import { createHash, createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { and, eq, gt, like, ne, or, sql } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, bearer, deviceAuthorization, magicLink, multiSession, organization, username } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import type { Db } from "../db";
import { emailConfigured, sendEmail, simpleEmail } from "../email";
import * as schema from "../db/schema";
import { isAvatarImage } from "../avatars";
import { sameSecret } from "../secrets";
import type { DeploymentProfile } from "../profile";
import { roleRank } from "./permissions";
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
let codeSecret: string | undefined;
/** Made on first use: Workers don't allow random values while a module loads. */
export function signInCodeSecret(): string {
  codeSecret ??= crypto.randomUUID();
  return codeSecret;
}

export function takeIssuedCode(captureId: string): string | undefined {
  const token = issuedCodes.get(captureId);
  issuedCodes.delete(captureId);
  return token;
}

/** Cloud: the accounts with these emails run the server (STRATA_ADMIN_EMAILS, comma-separated). */
export function isAdminEmail(profile: DeploymentProfile, email: string | null | undefined): boolean {
  if (!profile.adminsByEmail || !email) return false;
  const list = (process.env.STRATA_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return list.includes(email.toLowerCase());
}

const ownsHousehold = async (db: Db, userId: string) =>
  (await db.select({ id: schema.member.id }).from(schema.member).where(and(eq(schema.member.userId, userId), like(schema.member.role, "%owner%"))).limit(1)).length > 0;

/**
 * Whether an account is the system admin: it runs the server (the backoffice: server
 * settings, logs, households). Home: the account made at setup (role "admin"). Cloud: the
 * environment decides, every request: an email in STRATA_ADMIN_EMAILS, so taking one off
 * the list takes the access away at once.
 */
export function isSystemAdmin(profile: DeploymentProfile, user: { role?: string | null; email?: string | null; emailVerified?: boolean | null }): boolean {
  return profile.adminsByEmail ? isAdminEmail(profile, user.email) && adminEmailProven(user) : user.role === "admin";
}

/**
 * Cloud with email set up: an admin's address counts once it's confirmed by mail, so nobody
 * becomes the server's admin by signing up (or being invited) with that address first.
 * Without email nothing can be confirmed, and the list alone decides.
 */
function adminEmailProven(user: { emailVerified?: boolean | null }): boolean {
  return !emailConfigured() || !!user.emailVerified;
}
/**
 * The ways in besides a password, each on only when the server is set up for it, so a
 * home server shows neither:
 * - Google: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (redirect URI
 *   `<address>/api/auth/callback/google`).
 * - Passkeys: a public HTTPS address (STRATA_PUBLIC_URL); browsers only allow them on HTTPS.
 *   They belong to its host, or to STRATA_PASSKEY_RP_ID, a domain it's under: passkeys
 *   made at strata.example.com keep working when the server moves to app.strata.example.com.
 */
export function signInMethods() {
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } : null;
  let passkeys: { rpID: string; origin: string } | null = null;
  try {
    const url = process.env.STRATA_PUBLIC_URL ? new URL(process.env.STRATA_PUBLIC_URL) : null;
    const rpID = process.env.STRATA_PASSKEY_RP_ID || url?.hostname;
    const under = !!url && !!rpID && (url.hostname === rpID || url.hostname.endsWith(`.${rpID}`));
    if (url?.protocol === "https:" && under) passkeys = { rpID: rpID!, origin: url.origin };
  } catch {
    // Not a URL: no passkeys.
  }
  return { google, passkeys };
}

/** The admin plugin's permissions (see `admin()` below for who gets which). */
const accessControl = createAccessControl(defaultStatements);

/**
 * Better Auth paths a watch-only session (viewerOnly) may not call: the admin plugin, the
 * household changes beyond picking one, and anything that adds or removes a way in.
 */
const VIEWER_REFUSED =
  /^\/(admin\/|organization\/(?!(list|set-active|get-full-organization|get-active-member|get-active-member-role)$)|passkey\/|link-social|unlink-account|delete-user|set-password|revoke-sessions|revoke-other-sessions|multi-session\/revoke)/;


/**
 * May the signed-in caller manage `userId`'s account (reset its password, delete it)? The
 * server's admin may manage anyone else's; a household's owner or admin, someone below
 * them in their active household, but never the server's admin. Never your own, and never
 * from a device that joined without a password.
 */
export async function assertMayManage(db: Db, profile: DeploymentProfile, getSession: (headers: Headers) => Promise<{ user: { id: string }; session: unknown } | null>, headers: Headers | undefined, userId: string) {
  // Asked through Better Auth's own getSession: a hook runs before the bearer plugin has
  // turned the apps' token into a session.
  const caller = headers ? await getSession(headers) : null;
  const session = caller?.session as { activeOrganizationId?: string | null; viewerOnly?: boolean | null } | undefined;
  const refuse = (message: string) => {
    throw new APIError("FORBIDDEN", { message });
  };
  if (!caller || session?.viewerOnly) refuse("Sign in with your password to do that.");
  if (caller!.user.id === userId) refuse("That's your own account: use your account menu.");
  const [target] = await db.select({ role: schema.user.role, email: schema.user.email, emailVerified: schema.user.emailVerified, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
  if (!target) refuse("No such account.");
  if (isSystemAdmin(profile, caller!.user as { role?: string | null; email?: string | null; emailVerified?: boolean | null })) return;
  if (isSystemAdmin(profile, target!)) refuse("Only the server's admin can manage that account.");
  const household = session?.activeOrganizationId;
  if (!household) refuse("Choose a household first.");
  const roles = await db
    .select({ userId: schema.member.userId, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, household!), or(eq(schema.member.userId, caller!.user.id), eq(schema.member.userId, userId))));
  const mine = roles.find((r) => r.userId === caller!.user.id);
  const theirs = roles.find((r) => r.userId === userId);
  if (!mine || roleRank(mine.role) < 1) refuse("Only the household's owner or admins can do that.");
  if (!theirs) refuse(`${target!.name} isn't in this household.`);
  if (roleRank(theirs!.role) >= roleRank(mine!.role)) refuse(`Only someone above ${target!.name} in the household can do that.`);
  // The account is theirs everywhere: someone also in another household is managed by the
  // server's admin, not by one household's admins.
  const [elsewhere] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), ne(schema.member.organizationId, household!)))
    .limit(1);
  if (elsewhere) refuse(`${target!.name} is in another household too, so only the server's admin can do that.`);
}

export interface AuthOptions {
  db: Db;
  profile: DeploymentProfile;
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
  const { db, profile } = options;
  const methods = signInMethods();
  const confirmEmail = profile.openSignUp && emailConfigured();
  // Hooks below ask Better Auth's own API (getSession) of the instance they belong to.
  const auth = betterAuth({
    appName: "Strata",
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The hosted public demo shares one account: nobody may change it.
        if (profile.readOnly && /^\/(change-password|update-user|change-email|delete-user|set-password|admin\/|organization\/(create|update|delete|invite-member|remove-member|update-member-role|leave|cancel-invitation)$)/.test(ctx.path)) {
          throw new APIError("FORBIDDEN", { message: "The demo can't be changed." });
        }
        // A device that joined without a password (home network, QR code, TV) may watch and
        // tend its own sign-in, never administer: its session can't reach the admin plugin,
        // change households, or add a way in (passkey, Google) that outlives it.
        if (VIEWER_REFUSED.test(ctx.path)) {
          const caller = ctx.headers ? await auth.api.getSession({ headers: ctx.headers }) : null;
          if ((caller?.session as { viewerOnly?: boolean | null } | undefined)?.viewerOnly) {
            throw new APIError("FORBIDDEN", { message: "Sign in with your password to do that." });
          }
        }
        // Sign-in codes are only made by the server (api/routes/auth.ts, for a household's
        // admins or the member themself), never asked for from outside.
        if (ctx.path === "/sign-in/magic-link" && !sameSecret(ctx.headers?.get(SIGN_IN_CODE_HEADER) ?? "", signInCodeSecret())) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
        }
        // Password reset is by email: without email set up there's nothing to send.
        if ((ctx.path === "/request-password-reset" || ctx.path === "/forget-password") && !emailConfigured()) {
          throw new APIError("NOT_FOUND", { message: "This server can't send email. Ask your household's admin to help." });
        }
        // Resetting someone's password or deleting their account (the admin plugin's
        // set-user-password and remove-user): the server's admin, or a household's owner or
        // admin for someone below them in it.
        if (ctx.path === "/admin/set-user-password" || ctx.path === "/admin/remove-user") {
          await assertMayManage(db, profile, (headers) => auth.api.getSession({ headers }), ctx.headers, String((ctx.body as { userId?: unknown } | undefined)?.userId ?? ""));
          return;
        }
        // A profile picture is one of Strata's own (src/avatars) or none: nobody can point
        // their profile at an image from elsewhere.
        if ((ctx.path === "/update-user" || ctx.path === "/admin/update-user") && ctx.body && typeof ctx.body === "object") {
          const image = (ctx.body as { image?: unknown; data?: { image?: unknown } }).image ?? (ctx.body as { data?: { image?: unknown } }).data?.image;
          if (image != null && !isAvatarImage(image)) throw new APIError("BAD_REQUEST", { message: "Pick one of the server's profile pictures." });
          return;
        }
        if (ctx.path !== "/sign-up/email") return;
        // Cloud: anyone may sign up and gets a household of their own (see `after`). With an
        // invitation's id they join that household instead, checked as below.
        if (profile.openSignUp && !(ctx.body as { invitationId?: unknown } | undefined)?.invitationId) return;
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
        // Cloud: a new account without an invitation owns a new household, named after them
        // (onboarding lets them rename it), and the sign-in opens in it. By password, or by
        // Google: its first sign-in (an account in no household yet, just made).
        // An account that must confirm its email first gets no sign-in yet: the household is
        // made now, and its first sign-in opens in it (databaseHooks.session).
        if (ctx.path === "/sign-up/email" || ctx.path === "/callback/:id") {
          const created = ctx.context.newSession;
          const returned = ctx.context.returned as { user?: { id: string; name: string; createdAt: Date | string } } | undefined;
          const user = created?.user ?? (ctx.path === "/sign-up/email" && returned && !(returned instanceof Error) ? returned.user : undefined);
          if (!profile.openSignUp || !user || (ctx.body as { invitationId?: unknown } | undefined)?.invitationId) return;
          if (ctx.path === "/callback/:id") {
            const isNew = Date.now() - new Date(user.createdAt).getTime() < 10 * 60_000;
            const [inOne] = await db.select({ id: schema.member.id }).from(schema.member).where(eq(schema.member.userId, user.id)).limit(1);
            if (!isNew || inOne) return;
          }
          const household = await auth.api.createOrganization({
            body: { name: `${user.name}'s home`, slug: `home-${crypto.randomUUID().slice(0, 8)}`, userId: user.id },
          });
          if (household && created) await adapter.updateSession(created.session.token, { activeOrganizationId: household.id });
          return;
        }
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
        // A password set by someone else is temporary: every device of theirs is signed out,
        // and their next sign-in asks for a new one before anything else (api/context.ts).
        if (ctx.path === "/admin/set-user-password") {
          const userId = String((ctx.body as { userId?: unknown } | undefined)?.userId ?? "");
          if (userId && ctx.context.returned && !(ctx.context.returned instanceof Error)) {
            await adapter.deleteUserSessions(userId);
            await db.update(schema.user).set({ mustChangePassword: true }).where(eq(schema.user.id, userId));
          }
          return;
        }
        // Choosing a new password replaces a temporary one from an admin.
        if (ctx.path === "/change-password") {
          const userId = ctx.context.session?.user.id;
          if (userId && ctx.context.returned && !(ctx.context.returned instanceof Error)) {
            await db.update(schema.user).set({ mustChangePassword: false }).where(eq(schema.user.id, userId));
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
      user: {
        create: {
          // Cloud: the server's admins are named by email (STRATA_ADMIN_EMAILS). A picture
          // from elsewhere (Google's) isn't kept: profile pictures are the server's own.
          // Someone signing up from an invitation counts as confirmed: the household's admin
          // sent the link to that address (the sign-up hook checked the invitation).
          before: async (user, ctx) => {
            const image = user.image != null && !isAvatarImage(user.image) ? null : user.image;
            // An invitation's link is passed on by hand, so it doesn't prove an admin's address.
            const invited = ctx?.path === "/sign-up/email" && !!(ctx.body as { invitationId?: unknown } | undefined)?.invitationId && !(confirmEmail && isAdminEmail(profile, user.email));
            const emailVerified = invited || !!user.emailVerified;
            return { data: { ...user, image, ...(invited ? { emailVerified: true } : {}), ...(isSystemAdmin(profile, { email: user.email, emailVerified }) ? { role: "admin" } : {}) } };
          },
        },
        delete: {
          // Whoever deletes it: an owner hands their household on first (unless nobody
          // else is in it), and the server's only admin stays.
          before: async (user) => {
            if ((user as { role?: string | null }).role === "admin") {
              const admins = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, "admin")).limit(2);
              if (admins.length < 2) throw new APIError("BAD_REQUEST", { message: "That's this server's only admin, so the account can't be deleted." });
            }
            const owned = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(and(eq(schema.member.userId, user.id), like(schema.member.role, "%owner%")));
            for (const { organizationId } of owned) {
              const people = await db.select({ userId: schema.member.userId, role: schema.member.role }).from(schema.member).where(eq(schema.member.organizationId, organizationId));
              const otherOwner = people.some((p) => p.userId !== user.id && p.role.split(",").includes("owner"));
              if (people.length > 1 && !otherOwner) {
                throw new APIError("BAD_REQUEST", { message: `${user.name} owns a household with other people in it. Make one of them its owner first (Members).` });
              }
            }
          },
          // Their progress, lists and sign-ins go with them (the database cascades); a
          // household nobody's in any more goes too, with its library, settings and keys.
          after: async () => {
            const orphans = await db
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(sql`not exists (select 1 from ${schema.member} where ${schema.member.organizationId} = ${schema.organization.id})`);
            for (const o of orphans) await db.delete(schema.organization).where(eq(schema.organization.id, o.id));
          },
        },
      },
      session: {
        create: {
          // A new sign-in opens in the account's household when it has just one.
          before: async (session) => {
            // …and on each sign-in the role follows the list (Better Auth's admin plugin reads
            // it): added after signing up, or taken off.
            if (profile.adminsByEmail) {
              const [u] = await db.select({ email: schema.user.email, emailVerified: schema.user.emailVerified, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, session.userId));
              const role = u && isSystemAdmin(profile, u) ? "admin" : "user";
              if (u && (u.role ?? "user") !== role) await db.update(schema.user).set({ role }).where(eq(schema.user.id, session.userId));
            }
            if ((session as { activeOrganizationId?: string | null }).activeOrganizationId) return;
            const rows = await db.select({ id: schema.member.organizationId }).from(schema.member).where(eq(schema.member.userId, session.userId)).limit(2);
            if (rows.length === 1) return { data: { ...session, activeOrganizationId: rows[0]!.id } };
          },
        },
      },
    },
    basePath: "/api/auth",
    baseURL: options.baseURL,
    // The site in front (STRATA_SITE_URL) passes /api through to this server.
    ...(process.env.STRATA_SITE_URL ? { trustedOrigins: [new URL(process.env.STRATA_SITE_URL).origin] } : {}),
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
    // Home servers: Google signs in only an account that connected it while signed in
    // (Settings › Account): it never makes an account. Cloud: it also signs up, like the
    // Create account form. Neither joins an account by matching email (many Strata accounts
    // have none), and the Google address needn't be the account's.
    socialProviders: methods.google ? { google: { ...methods.google, disableSignUp: !profile.openSignUp, disableImplicitSignUp: !profile.openSignUp } } : {},
    account: {
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
    },
    emailAndPassword: {
      enabled: true,
      // Cloud (with email set up): a new account confirms its address before it can sign in.
      requireEmailVerification: confirmEmail,
      // Home servers: open only to someone with a pending invitation (see `hooks`); the
      // first account comes from setup (routes/auth.ts). Cloud: open to anyone.
      disableSignUp: false,
      minPasswordLength: 8,
      maxPasswordLength: 256,
      password: {
        hash: (password) => runtime.hashPassword(password),
        verify: ({ hash, password }) => runtime.verifyPassword(password, hash),
      },
      // A new password signs the account out everywhere else.
      revokeSessionsOnPasswordReset: true,
      // "Forgot password?" (only with email set up, see ../email.ts): a link for an hour.
      resetPasswordTokenExpiresIn: 60 * 60,
      // A password chosen by its owner replaces any temporary one.
      onPasswordReset: async ({ user }) => {
        await db.update(schema.user).set({ mustChangePassword: false }).where(eq(schema.user.id, user.id));
      },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your Strata password",
          ...simpleEmail({
            greeting: `Hi ${user.name},`,
            lines: ["Someone asked to reset the password for your Strata account. If it was you, choose a new one with the button below. The link works for an hour."],
            button: { label: "Choose a new password", url },
            footer: "If you didn't ask, ignore this email: your password stays as it is.",
          }),
        });
      },
    },
    // The link in the confirmation email signs them in and opens onboarding; signing in
    // before confirming sends a fresh link.
    emailVerification: {
      sendOnSignUp: confirmEmail,
      sendOnSignIn: confirmEmail,
      autoSignInAfterVerification: true,
      expiresIn: DAY_S,
      sendVerificationEmail: async ({ user, url }) => {
        if (user.emailVerified) return; // invited: nothing to confirm
        await sendEmail({
          to: user.email,
          subject: "Confirm your email for Strata",
          ...simpleEmail({
            greeting: `Hi ${user.name},`,
            lines: ["Welcome to Strata. Confirm this is your email address to finish making your account. The link works for a day."],
            button: { label: "Confirm my email", url },
            footer: "If you didn't make a Strata account, ignore this email: nothing happens without the link.",
          }),
        });
      },
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
      additionalFields: {
        // Set when an admin resets the password to a temporary one (api/routes/auth.ts);
        // cleared by choosing a new one.
        mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      },
      changeEmail: { enabled: false },
      // Accounts are deleted by a household's admins (Members, Better Auth's admin
      // remove-user) or by the person themself; the rules are in databaseHooks.user.delete.
      deleteUser: { enabled: true },
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
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        // Everyone may ask to set another account's password or delete it; the `before`
        // hook allows it only for a household's owner or admin over someone below them (or
        // the server's admin).
        ac: accessControl,
        roles: { admin: accessControl.newRole(adminAc.statements), user: accessControl.newRole({ user: ["set-password", "delete"], session: [] }) },
      }),
      organization({
        // Invitations last a week; the dashboard shows their link (no mail is sent), and
        // its id is what proves the invitee (see the sign-up hook), not a verified email.
        invitationExpiresIn: 7 * DAY_S,
        requireEmailVerificationOnInvitation: false,
        sendInvitationEmail: async () => {},
        // Households are made by the server admin (or setup); in the cloud, also one by each
        // new account (its own, see the sign-up `after` hook).
        allowUserToCreateOrganization: async (user) => isSystemAdmin(profile, user as { role?: string | null; email?: string | null; emailVerified?: boolean | null }) || (profile.openSignUp && !(await ownsHousehold(db, user.id))),
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
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
