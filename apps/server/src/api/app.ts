import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { TmdbError } from "../catalog/tmdb";
import { PlaybackError } from "../playback/service";
import { TorboxError } from "../sources/torbox/client";
import type { Services } from "../services";
import { logger } from "../log";
import type { Env } from "./context";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { catalogRoutes } from "./routes/catalog";
import { streamRoutes } from "./routes/stream";
import { webHandler } from "../web/static";

const log = logger("http");

export function createApp(services: Services) {
  const app = new Hono<Env>();

  // Stream responses skip CORS (and any header-rewriting middleware): see serveRange.
  const corsMiddleware = cors();
  app.use("/api/*", (c, next) => (c.req.path.startsWith("/api/stream/") ? next() : corsMiddleware(c, next)));
  app.use(async (c, next) => {
    c.set("services", services);
    await next();
  });

  // Order matters: catalogRoutes applies requireAuth to everything it sees under /api,
  // so the public and stream routes must be registered first.
  app.route("/api", authRoutes);
  app.route("/api", streamRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api", catalogRoutes);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.get("*", webHandler(services.config.webDir));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    if (err instanceof TmdbError || err instanceof PlaybackError || err instanceof TorboxError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    log.error(`${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Internal error" }, 500);
  });

  return app;
}
