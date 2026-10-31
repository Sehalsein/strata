// The cloud server on Cloudflare Workers. Built by wrangler (deploy/cloudflare/), which
// resolves `#runtime` to src/runtime/workers.ts. The dashboard is served as static
// assets by Cloudflare; only /api/* reaches this Worker.
//
// Each request (and cron run) gets its own database connection, straight to Neon (see
// runtime/workers.ts). The services are built once per Worker instance, on its first
// request; their caches are per instance and everything lasting is in the database.
import { createApp } from "./api/app";
import { closeScope, drainScope, requestScope, type RequestScope } from "./runtime/workers";
import { pendingReports } from "./errorReporting";
import { CRON_JOBS } from "./cloudSchedule";
import type { Services } from "./services";

interface Env {
  /** Neon's connection string (a secret). */
  DATABASE_URL: string;
  /** 32 random bytes, base64: encrypts the API keys stored in the database (a secret). */
  STRATA_SECRET_KEY: string;
  /** The address people reach the server at, e.g. https://strata.example.com. */
  STRATA_PUBLIC_URL?: string;
  /** Email (password reset) by Resend: both, or no email at all. */
  RESEND_API_KEY?: string;
  STRATA_EMAIL_FROM?: string;
  /** Who runs the server and how to reach them, for the privacy page. */
  STRATA_OPERATOR?: string;
  STRATA_PRIVACY_CONTACT?: string;
  /** Errors to Sentry, when set. */
  SENTRY_DSN?: string;
  /** Emails whose accounts run the server (comma-separated). */
  STRATA_ADMIN_EMAILS?: string;
  /** "Sign in with Google" shows only with both. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type Booted = { services: Services; app: ReturnType<typeof createApp> };
let booted: Booted | undefined;

/**
 * Builds the services on the instance's first request (inside its database scope). Only a
 * finished boot is shared: Workers cancel a request's I/O when its client goes away, so a
 * boot shared while still running could never finish, and every request waiting on it
 * would hang. Requests that arrive together each boot; the first to finish is kept.
 */
async function boot(env: Env): Promise<Booted> {
  if (booted) return booted;
  // The server reads its configuration from the environment, as on Bun.
  Object.assign(process.env, {
    STRATA_NO_JOBS: "1", // Cron Triggers run the jobs (see `scheduled`)
    DATABASE_URL: env.DATABASE_URL,
    STRATA_SECRET_KEY: env.STRATA_SECRET_KEY,
    ...(env.STRATA_PUBLIC_URL ? { STRATA_PUBLIC_URL: env.STRATA_PUBLIC_URL } : {}),
    ...Object.fromEntries((["RESEND_API_KEY", "STRATA_EMAIL_FROM", "STRATA_OPERATOR", "STRATA_PRIVACY_CONTACT", "SENTRY_DSN", "STRATA_ADMIN_EMAILS"] as const).filter((k) => env[k]).map((k) => [k, env[k]!])),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
  });
  const { createServices } = await import("./services");
  const { parseArgs } = await import("./config");
  const { config } = parseArgs([]);
  const services = await createServices(config, { ffmpeg: null });
  booted ??= { services, app: createApp(services) };
  return booted;
}

/** Runs `fn` with a database connection of its own, closed once the work is done. */
async function inScope<T>(env: Env, ctx: ExecutionContext, fn: () => Promise<T>): Promise<T> {
  const scope: RequestScope = { connectionString: env.DATABASE_URL };
  try {
    return await requestScope.run(scope, fn);
  } finally {
    // Work started for after the response finishes first, on this request's connection.
    ctx.waitUntil(drainScope(scope).then(() => closeScope(scope)));
    ctx.waitUntil(pendingReports());
  }
}


export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return inScope(env, ctx, async () => {
      const { services, app } = await boot(env);
      // Another instance may have changed the server's settings.
      await services.settings.reloadIfOlderThan(60_000);
      return app.fetch(request, env, ctx as Parameters<typeof app.fetch>[2]);
    });
  },

  async scheduled(event: { cron: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    await inScope(env, ctx, async () => {
      const { services } = await boot(env);
      await services.settings.reloadIfOlderThan(0);
      for (const job of CRON_JOBS[event.cron] ?? []) await services.jobs.run(job);
    });
  },
};
