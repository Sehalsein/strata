import { expect, test } from "bun:test";

// The secret is read once at import and scrubbed from the environment.
test("launch secret is taken from the environment and removed", async () => {
  process.env.STRATA_LAUNCH_SECRET = "f".repeat(64);
  const { launchSecret } = await import(`../src/platform/launcher.ts?fresh=${Date.now()}`);
  expect(launchSecret()).toBe("f".repeat(64));
  expect(process.env.STRATA_LAUNCH_SECRET).toBeUndefined();
});
