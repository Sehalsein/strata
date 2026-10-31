import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

// The demo server sets itself up as its modules load, so it runs in its own process.
test("the public demo: App Review's sign-in, browsing, nothing changeable, sign-ins restored after a restart", async () => {
  const restoreKey = randomBytes(32).toString("hex");
  const proc = Bun.spawn(["bun", join(import.meta.dir, "scenarios/demo.ts")], {
    env: { ...process.env, TMDB_API_KEY: "test-key", DEMO_RESTORE_KEY: restoreKey, STRATA_SECRET_KEY: Buffer.from(restoreKey, "hex").toString("base64"), STRATA_NO_FFMPEG_DOWNLOAD: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) console.error(out, err);
  expect(code).toBe(0);
}, 120_000);
