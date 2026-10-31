import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { member, session as sessionTable } from "../db/schema";
import { describeDevice, deviceChanges } from "./deviceInfo";
import { isSystemAdmin } from "../auth/betterAuth";
import type { Household } from "../household";
import type { Services } from "../services";

/** Who's asking: their account, this device's household (if any) and their role in it. */
export interface RequestSession {
  /** Better Auth's session token (the bearer token). */
  token: string;
  user: { id: string; username: string | null; name: string; email: string; image: string | null; isServerAdmin: boolean };
  organizationId: string | null;
  /** "owner" | "admin" | "member" in the active household, once `requireHousehold` ran. */
  role: string | null;
  /** Joined without a password or a TV: can watch, never administer. */
  viewerOnly: boolean;
  /** Signed in with a temporary password: only /me works until a new one is chosen. */
  mustChangePassword: boolean;
}

/** The answer to anything but /api/me while a temporary password is in use. */
export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

export type Env = {
  /** The Bun server, passed as the second argument to fetch (absent in tests unless given). */
  Bindings: {
    requestIP?: (req: Request) => { address: string } | null;
  };
  Variables: {
    services: Services;
    session: RequestSession;
    household: Household;
  };
};

/** A signed-in account (Better Auth session, from the bearer token or cookie). */
export const requireAuth: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const result = await c.var.services.auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  if (!result) throw new HTTPException(401, { message: "Not signed in" });
  const u = result.user as typeof result.user & { username?: string | null; role?: string | null; banned?: boolean | null; mustChangePassword?: boolean | null };
  const s = result.session as typeof result.session & { activeOrganizationId?: string | null; viewerOnly?: boolean | null };
  const viewerOnly = !!s.viewerOnly;
  // Keeps the Devices page current: where the device is now, and what it is. Written only
  // when something changed, which is rare (a new network, an app update).
  const changes = deviceChanges(s as Parameters<typeof deviceChanges>[0], describeDevice(c));
  if (changes) {
    await c.var.services.db
      .update(sessionTable)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(sessionTable.token, s.token))
      .catch(() => {});
  }
  c.set("session", {
    token: s.token,
    user: { id: u.id, username: u.username ?? null, name: u.name, email: u.email, image: u.image ?? null, isServerAdmin: isSystemAdmin(u) && !viewerOnly },
    organizationId: s.activeOrganizationId ?? null,
    role: null,
    viewerOnly,
    // Devices that joined without a password (home, a TV) never used the temporary one.
    mustChangePassword: !!u.mustChangePassword && !viewerOnly,
  });
  if (!!u.mustChangePassword && !viewerOnly && new URL(c.req.url).pathname !== "/api/me") {
    throw new HTTPException(403, {
      res: Response.json({ error: "Choose a new password first: you signed in with a temporary one.", code: PASSWORD_CHANGE_REQUIRED }, { status: 403 }),
    });
  }
  await next();
});

/**
 * The device's household: set (with `/api/auth/organization/set-active`) and one the
 * account belongs to. Loads that household's services for the route.
 */
export const requireHousehold: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const session = c.var.session;
  if (!session.organizationId) throw new HTTPException(409, { message: "Choose a household first" });
  const [row] = await c.var.services.db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, session.organizationId), eq(member.userId, session.user.id)));
  if (!row) throw new HTTPException(403, { message: "You're not in this household" });
  session.role = row.role;
  c.set("household", await c.var.services.households.get(session.organizationId));
  await next();
});

/** The household's owner or an admin, signed in with a password (not a TV or home join). */
export const requireHouseholdAdmin: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (process.env.STRATA_DEMO === "1") throw new HTTPException(403, { message: "The demo can't be changed." });
  const { role, viewerOnly } = c.var.session;
  const roles = (role ?? "").split(",");
  if (viewerOnly || !(roles.includes("owner") || roles.includes("admin"))) throw new HTTPException(403, { message: "Only the household's owner or admins can do that" });
  await next();
});

/** The server admin (the account made at setup), signed in with a password. */
export const requireServerAdmin: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (process.env.STRATA_DEMO === "1") throw new HTTPException(403, { message: "The demo can't be changed." });
  if (!c.var.session.user.isServerAdmin) throw new HTTPException(403, { message: "Only the server's admin can do that" });
  await next();
});

/** The signed-in account: whose progress and lists these are. */
export function userOf(c: Context<Env>): string {
  return c.var.session.user.id;
}

export async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  // Requiring application/json makes any cross-origin request preflighted, so a web
  // page can't silently drive the API (e.g. claim first-run setup).
  const type = c.req.header("content-type");
  // A bodyless request lets the schema's defaults apply.
  if (!type && !c.req.header("content-length") && !c.req.header("transfer-encoding")) return schema.parse(undefined);
  if (!type?.toLowerCase().startsWith("application/json")) {
    throw new HTTPException(415, { message: "Expected Content-Type: application/json" });
  }
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Expected a JSON body" });
  }
  return schema.parse(json);
}

export function intParam(c: Context, name: string): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value)) throw new HTTPException(400, { message: `Invalid ${name}` });
  return value;
}

export function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HTTPException(400, { message: `Invalid number ${value}` });
  return n;
}
