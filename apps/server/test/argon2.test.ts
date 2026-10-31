import { expect, test } from "bun:test";
import { hashArgon2id, verifyArgon2id } from "../src/runtime/argon2";

// The cloud's hashing (Workers can't compile WebAssembly) must agree with Bun's at home.
test("Workers argon2id: verifies its own hashes and Bun's, and refuses wrong passwords", async () => {
  const ours = await hashArgon2id("a-good-password");
  expect(ours).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  expect(await verifyArgon2id("a-good-password", ours)).toBe(true);
  expect(await verifyArgon2id("a-bad-password", ours)).toBe(false);
  expect(await Bun.password.verify("a-good-password", ours)).toBe(true);

  const bun = await Bun.password.hash("a-good-password", { algorithm: "argon2id" });
  expect(await verifyArgon2id("a-good-password", bun)).toBe(true);
  expect(await verifyArgon2id("a-bad-password", bun)).toBe(false);
  expect(await verifyArgon2id("a-good-password", "not a hash")).toBe(false);
}, 30_000);
