import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import type { AuthContext } from "better-auth";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "../db";
import * as schema from "../db/schema";

/**
 * Usernames, unique within a household rather than across the server (in place of Better
 * Auth's username plugin, which is server-wide): in the cloud, everyone's "alex" needn't be
 * the same "alex". Two people in one household never share one.
 *
 * Signing in by username tries the password against each account with that name, and signs
 * in the one it opens. If it opens more than one (same name and same password, in
 * different households), it signs in neither: an email names one account.
 */
export interface HouseholdUsernameOptions {
  db: Db;
  minLength: number;
  maxLength: number;
  /** Whether this account must confirm its email before it may sign in (and then sends a link). */
  mustConfirmEmail: (user: { emailVerified: boolean; joinedByInvitation?: boolean | null }) => boolean;
  sendConfirmation: (ctx: ConfirmationContext, email: string, callbackURL?: string) => Promise<void>;
  /** The caller's account, by their headers (bearer token or cookie). */
  callerOf: (headers: Headers | undefined) => Promise<{ id: string; username?: string | null } | null>;
}

/** What sending a confirmation link needs of the request it answers. */
export type ConfirmationContext = { context: AuthContext; request?: Request };

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

const TAKEN_MESSAGE = "Someone in this household already uses that username. Pick another.";
const WRONG = { code: "INVALID_USERNAME_OR_PASSWORD", message: "Invalid username or password" };

export function householdUsername(options: HouseholdUsernameOptions) {
  const { db } = options;

  const invalid = (username: string): string | null => {
    if (username.length < options.minLength) return "Username is too short";
    if (username.length > options.maxLength) return "Username is too long";
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return "Usernames can use letters, numbers, dots, dashes and underscores";
    return null;
  };
  const assertValid = (username: string) => {
    const problem = invalid(username);
    if (problem) throw new APIError("BAD_REQUEST", { code: "INVALID_USERNAME", message: problem });
  };

  /** Whether someone other than `exceptUserId` in any of `households` already uses `username`. */
  const takenIn = async (username: string, households: string[], exceptUserId?: string): Promise<boolean> => {
    if (!households.length) return false;
    const [row] = await db
      .select({ id: schema.user.id })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(
        and(
          inArray(schema.member.organizationId, households),
          eq(schema.user.username, normalizeUsername(username)),
          ...(exceptUserId ? [ne(schema.user.id, exceptUserId)] : []),
        ),
      )
      .limit(1);
    return !!row;
  };
  const householdsOf = async (userId: string) =>
    (await db.select({ id: schema.member.organizationId }).from(schema.member).where(eq(schema.member.userId, userId))).map((r) => r.id);
  const invitationHousehold = async (invitationId: unknown) => {
    if (typeof invitationId !== "string" || !invitationId) return null;
    const [row] = await db.select({ organizationId: schema.invitation.organizationId }).from(schema.invitation).where(eq(schema.invitation.id, invitationId));
    return row?.organizationId ?? null;
  };

  const normalizeFields = <T extends Record<string, unknown>>(user: T, creating: boolean): T => {
    const username = typeof user.username === "string" ? user.username : null;
    if (!username) return user;
    const displayUsername = typeof user.displayUsername === "string" && user.displayUsername ? user.displayUsername : creating ? username.trim() : undefined;
    return { ...user, username: normalizeUsername(username), ...(displayUsername !== undefined ? { displayUsername } : {}) };
  };

  return {
    id: "username",
    init: () => ({
      options: {
        databaseHooks: {
          user: {
            create: { before: async (user) => ({ data: normalizeFields(user as Record<string, unknown>, true) as typeof user }) },
            update: { before: async (user) => ({ data: normalizeFields(user as Record<string, unknown>, false) as typeof user }) },
          },
        },
      },
    }),
    schema: {
      user: {
        fields: {
          username: { type: "string", required: false, sortable: true, returned: true },
          displayUsername: { type: "string", required: false },
        },
      },
    },
    hooks: {
      before: [
        {
          // A new account joins the invitation's household (or, without one, makes its
          // own): only that household's names matter.
          matcher: (ctx) => ctx.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { username?: unknown; invitationId?: unknown };
            if (typeof body.username !== "string") return;
            assertValid(body.username);
            const household = await invitationHousehold(body.invitationId);
            if (household && (await takenIn(body.username, [household]))) throw new APIError("BAD_REQUEST", { code: "USERNAME_IS_ALREADY_TAKEN", message: TAKEN_MESSAGE });
          }),
        },
        {
          // A new username mustn't be someone else's in any household they're in.
          matcher: (ctx) => ctx.path === "/update-user",
          handler: createAuthMiddleware(async (ctx) => {
            const username = (ctx.body as { username?: unknown } | undefined)?.username;
            if (typeof username !== "string") return;
            assertValid(username);
            const caller = await options.callerOf(ctx.headers);
            if (!caller) return;
            if (await takenIn(username, await householdsOf(caller.id), caller.id)) {
              throw new APIError("BAD_REQUEST", { code: "USERNAME_IS_ALREADY_TAKEN", message: TAKEN_MESSAGE });
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/admin/update-user",
          handler: createAuthMiddleware(async (ctx) => {
            const b = (ctx.body ?? {}) as { userId?: unknown; data?: { username?: unknown } };
            const username = b.data?.username;
            if (typeof username !== "string" || typeof b.userId !== "string") return;
            assertValid(username);
            if (await takenIn(username, await householdsOf(b.userId), b.userId)) throw new APIError("BAD_REQUEST", { code: "USERNAME_IS_ALREADY_TAKEN", message: TAKEN_MESSAGE });
          }),
        },
        {
          // An account already in another household joins this one: its name mustn't be
          // someone's here.
          matcher: (ctx) => ctx.path === "/organization/accept-invitation",
          handler: createAuthMiddleware(async (ctx) => {
            const caller = await options.callerOf(ctx.headers);
            const household = await invitationHousehold((ctx.body as { invitationId?: unknown } | undefined)?.invitationId);
            const username = caller?.username;
            if (!caller || !username || !household) return;
            if (await takenIn(username, [household], caller.id)) {
              throw new APIError("CONFLICT", {
                code: "USERNAME_IS_ALREADY_TAKEN",
                message: `Someone in that household already uses the username ${username}. Change yours in Settings › Account, then open the invitation again.`,
              });
            }
          }),
        },
      ],
    },
    endpoints: {
      signInUsername: createAuthEndpoint(
        "/sign-in/username",
        {
          method: "POST",
          body: z.object({
            username: z.string(),
            password: z.string(),
            rememberMe: z.boolean().optional(),
            callbackURL: z.string().optional(),
          }),
        },
        async (ctx) => {
          const { password } = ctx.body;
          const username = normalizeUsername(ctx.body.username);
          if (!username || !password || invalid(username) || password.length > 256) throw new APIError("UNAUTHORIZED", WRONG);
          const candidates = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, username));
          if (!candidates.length) {
            await ctx.context.password.hash(password); // as long as a wrong password takes
            throw new APIError("UNAUTHORIZED", WRONG);
          }
          const opened: string[] = [];
          for (const { id } of candidates) {
            const hash = (await ctx.context.internalAdapter.findCredentialAccount(id))?.password;
            if (hash && (await ctx.context.password.verify({ hash, password }))) opened.push(id);
          }
          if (opened.length !== 1) {
            throw new APIError("UNAUTHORIZED", opened.length ? { code: "AMBIGUOUS_USERNAME", message: "More than one account has that username and password. Sign in with your email instead." } : WRONG);
          }
          const user = (await ctx.context.internalAdapter.findUserById(opened[0]!)) as (Record<string, unknown> & { id: string; email: string; emailVerified: boolean; joinedByInvitation?: boolean | null }) | null;
          if (!user) throw new APIError("UNAUTHORIZED", WRONG);
          if (options.mustConfirmEmail(user)) {
            await options.sendConfirmation(ctx, user.email, ctx.body.callbackURL);
            throw new APIError("FORBIDDEN", { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id, ctx.body.rememberMe === false);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
          await setSessionCookie(ctx, { session, user: user as never }, ctx.body.rememberMe === false);
          if (ctx.body.callbackURL) ctx.setHeader("Location", ctx.body.callbackURL);
          return ctx.json({ redirect: !!ctx.body.callbackURL, token: session.token, url: ctx.body.callbackURL, user: parseUserOutput(ctx.context.options, user as never) });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
