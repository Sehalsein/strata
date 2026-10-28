import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { TmdbError } from "../catalog/tmdb";
import { PlaybackError } from "../playback/service";
import { TorboxError } from "../sources/torbox/client";
import { NotReadyError } from "../sources/discovery";
import type { Services } from "../services";
import { logger } from "../log";
import type { Env } from "./context";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { catalogRoutes } from "./routes/catalog";
import { streamRoutes } from "./routes/stream";
import { systemRoutes } from "./routes/system";
import { webHandler } from "../web/static";
import { gzipJson } from "./gzip";

const log = logger("http");

export function createApp(services: Services) {
  const app = new Hono<Env>();

  // No CORS: the dashboard is same-origin and native clients don't need it. Stream
  // responses must also stay unwrapped by header-rewriting middleware (see serveRange).
  app.use(async (c, next) => {
    c.set("services", services);
    await next();
  });

  app.use("/api/*", gzipJson());

  // Order matters: catalogRoutes applies requireAuth to everything it sees under /api,
  // so the public and stream routes must be registered first.
  app.route("/api", authRoutes);
  app.route("/api", streamRoutes);
  app.route("/api/admin", systemRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api", catalogRoutes);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.get("*", webHandler(services.config.webDir));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // Not an error for the client: the release is downloading; poll by repeating the request.
    // `title` and `message` are what the apps show while they wait.
    if (err instanceof NotReadyError) return c.json({ ...err.info, title: "Getting it ready", message: err.message, error: err.message }, 202);
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    if (err instanceof TmdbError || err instanceof PlaybackError || err instanceof TorboxError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    log.error(`${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Internal error" }, 500);
  });

  return app;
}
