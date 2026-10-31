import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { session } from "../src/db/schema";
import { setUp, startTestServer, type TestServer } from "./helpers";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  await setUp(server);
}, 60_000);

afterAll(() => server.services.shutdown());

test("a home server backs its database up into <data-dir>/backups", async () => {
  await server.services.jobs.run("backupDatabase");
  expect(readdirSync(join(server.dataDir, "backups")).some((f) => f.startsWith("strata-daily-") && f.endsWith(".tar.gz"))).toBe(true);
});

test("sign-ins past their expiry are deleted, with the device details they hold", async () => {
  const db = server.services.db;
  const [row] = await db.select({ id: session.id }).from(session).limit(1);
  await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.id, row!.id));
  await server.services.jobs.run("pruneAuth");
  expect(await db.select({ id: session.id }).from(session).where(eq(session.id, row!.id))).toHaveLength(0);
});

test("usage limits count per key and refuse once over, saying when to try again", async () => {
  const { RateLimitError } = await import("../src/throttle");
  const rule = { limit: 2, windowMs: 60_000, lockMs: 60_000 };
  const throttle = server.services.throttle;
  await throttle.spend("searches:test-household", rule, "Too many searches.");
  await throttle.spend("searches:test-household", rule, "Too many searches.");
  const refused = await throttle.spend("searches:test-household", rule, "Too many searches.").catch((e) => e);
  expect(refused).toBeInstanceOf(RateLimitError);
  expect(refused.message).toContain("Try again in 1 minute.");
  // Another household has its own count.
  await throttle.spend("searches:other-household", rule, "Too many searches.");
});

test("errors go to Sentry when SENTRY_DSN is set, with secrets stripped, once a minute each", async () => {
  const { logger } = await import("../src/log");
  const realFetch = globalThis.fetch;
  const sent: { url: string; body: string }[] = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    sent.push({ url: String(input), body: String(init?.body) });
    return new Response("{}");
  }) as typeof fetch;
  process.env.SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/42";
  try {
    const log = logger("test");
    log.error("TorBox link failed https://x.example/dl?token=secret123", new Error("boom"));
    log.error("TorBox link failed https://x.example/dl?token=secret123", new Error("boom"));
    await Bun.sleep(10); // the reports are sent in the background
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(sent[0]!.body).not.toContain("secret123");
    expect(sent[0]!.body).toContain("token=***");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SENTRY_DSN;
  }
});
