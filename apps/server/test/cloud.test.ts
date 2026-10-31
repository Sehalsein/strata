import { expect, test } from "bun:test";
import { join } from "node:path";

// The cloud build reads its mode once, as its modules load, so it runs in its own process.
test("cloud: open sign-up, a household per new account, invitations to join, admins by email", async () => {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "scenarios/cloud.ts")], {
    env: { ...process.env, STRATA_MODE: "cloud", STRATA_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"), STRATA_ADMIN_EMAILS: "boss@example.com, other@example.com" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) console.error(out, err);
  expect(code).toBe(0);
}, 60_000);
