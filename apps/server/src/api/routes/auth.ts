import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { profiles } from "../../db/schema";
import { API_VERSION, VERSION } from "../../version";
import { body, intParam, requireAdmin, requireAuth, type Env } from "../context";

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
});

export const authRoutes = new Hono<Env>()
  .get("/info", (c) => {
    const s = c.var.services;
    return c.json({ name: "strata", serverName: s.settings.get().serverName, version: VERSION, apiVersion: API_VERSION, setupRequired: !s.auth.hasAnyUser() });
  })

  // First-run: creates the admin and a first profile. Locked once any user exists.
  .post("/setup/admin", async (c) => {
    const s = c.var.services;
    const input = await body(c, credentials.extend({ password: z.string().min(8).max(256) }));
    if (s.auth.hasAnyUser()) throw new HTTPException(409, { message: "Setup already completed" });
    const user = await s.auth.createUser(input.username, input.password, true);
    s.db.insert(profiles).values({ name: input.username }).run();
    return c.json({ token: s.auth.issue(user.id, input.deviceName ?? "Dashboard") });
  })

  .post("/auth/login", async (c) => {
    const input = await body(c, credentials);
    const token = await c.var.services.auth.login(input.username, input.password, input.deviceName);
    if (!token) throw new HTTPException(401, { message: "Wrong username or password" });
    return c.json({ token });
  })

  .post("/auth/logout", requireAuth, (c) => {
    c.var.services.auth.logout(c.var.session.tokenHash);
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, (c) => {
    const { user, profileId } = c.var.session;
    const profile = profileId ? c.var.services.db.select().from(profiles).where(eq(profiles.id, profileId)).get() : undefined;
    return c.json({ user, profile: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar } : null });
  })

  .get("/profiles", requireAuth, (c) => {
    const rows = c.var.services.db.select().from(profiles).orderBy(asc(profiles.id)).all();
    return c.json(rows.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, hasPin: !!p.pinHash })));
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
    const row = c.var.services.db.insert(profiles).values({ name: input.name, avatar: input.avatar ?? null, pinHash }).returning().get();
    return c.json({ id: row.id, name: row.name, avatar: row.avatar, hasPin: !!row.pinHash }, 201);
  })

  .patch("/profiles/:id", requireAuth, requireAdmin, async (c) => {
    const input = await body(c, profileInput.partial());
    const patch: Partial<typeof profiles.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.avatar !== undefined) patch.avatar = input.avatar;
    if (input.pin !== undefined) patch.pinHash = input.pin ? await Bun.password.hash(input.pin) : null;
    const row = c.var.services.db.update(profiles).set(patch).where(eq(profiles.id, intParam(c, "id"))).returning().get();
    if (!row) throw new HTTPException(404, { message: "No such profile" });
    return c.json({ id: row.id, name: row.name, avatar: row.avatar, hasPin: !!row.pinHash });
  })

  .delete("/profiles/:id", requireAuth, requireAdmin, (c) => {
    const db = c.var.services.db;
    if (db.select().from(profiles).all().length <= 1) throw new HTTPException(409, { message: "Can't delete the last profile" });
    db.delete(profiles).where(eq(profiles.id, intParam(c, "id"))).run();
    return c.json({ ok: true });
  });
