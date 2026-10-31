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
