import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AuthedSession } from "../auth";
import type { Services } from "../services";

export type Env = {
  /** The Bun server, passed as the second argument to fetch (absent in tests unless given). */
  Bindings: {
    requestIP?: (req: Request) => { address: string } | null;
  };
  Variables: {
    services: Services;
    session: AuthedSession;
  };
};

export const requireAuth: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const session = token ? c.var.services.auth.verify(token) : null;
  if (!session) throw new HTTPException(401, { message: "Not signed in" });
  c.set("session", session);
  await next();
});

export const requireAdmin: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (!c.var.session.user.isAdmin) throw new HTTPException(403, { message: "Admin only" });
  await next();
});

export function profileOf(c: Context<Env>): number {
  const id = c.var.session.profileId;
  if (id === null) throw new HTTPException(409, { message: "Select a profile first" });
  return id;
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
