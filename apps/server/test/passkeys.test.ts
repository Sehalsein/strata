import { afterEach, expect, test } from "bun:test";
import { passkey } from "../src/db/schema";
import { isIpAddress, signInMethods, viewerMayCall, demoRefuses } from "../src/auth/betterAuth";
import { deploymentProfile } from "../src/profile";
import { setUp, startTestServer } from "./helpers";

const home = deploymentProfile("home", "bun");
const cloud = deploymentProfile("cloud", "workers");

afterEach(() => {
  delete process.env.STRATA_PUBLIC_URL;
  delete process.env.STRATA_PASSKEY_RP_ID;
});

test("a home server without an HTTPS address offers passkeys at http://localhost only", () => {
  expect(signInMethods({ profile: home, port: 8420 }).passkeys).toEqual({ rpID: "localhost", origin: ["http://localhost:8420"] });
  // A plain-HTTP or IP address doesn't change that: browsers refuse passkeys there.
  process.env.STRATA_PUBLIC_URL = "http://192.168.1.20:8420";
  expect(signInMethods({ profile: home, port: 8420 }).passkeys).toEqual({ rpID: "localhost", origin: ["http://localhost:8420"] });
  process.env.STRATA_PUBLIC_URL = "https://192.168.1.20";
  expect(signInMethods({ profile: home, port: 8420 }).passkeys?.rpID).toBe("localhost");
  // The cloud is never browsed at its localhost.
  delete process.env.STRATA_PUBLIC_URL;
  expect(signInMethods({ profile: cloud, port: 8420 }).passkeys).toBeNull();
  process.env.STRATA_PUBLIC_URL = "http://strata.example.com";
  expect(signInMethods({ profile: cloud, port: 8420 }).passkeys).toBeNull();
});

test("an HTTPS address gives passkeys to its host, or to a domain it's under", () => {
  process.env.STRATA_PUBLIC_URL = "https://Strata.Example.com/";
  for (const profile of [home, cloud]) expect(signInMethods({ profile, port: 8420 }).passkeys).toEqual({ rpID: "strata.example.com", origin: ["https://strata.example.com"] });
  process.env.STRATA_PUBLIC_URL = "https://app.strata.example.com";
  process.env.STRATA_PASSKEY_RP_ID = "strata.example.com";
  expect(signInMethods({ profile: cloud }).passkeys).toEqual({ rpID: "strata.example.com", origin: ["https://app.strata.example.com"] });
  // A domain the address isn't under would make every passkey fail.
  process.env.STRATA_PASSKEY_RP_ID = "other.example.com";
  expect(signInMethods({ profile: cloud }).passkeys).toBeNull();
  process.env.STRATA_PUBLIC_URL = "not a url";
  expect(signInMethods({ profile: cloud }).passkeys).toBeNull();
});

test("IP addresses are told apart from hostnames", () => {
  for (const h of ["192.168.1.20", "10.0.0.1", "[::1]", "fe80::1"]) expect(isIpAddress(h)).toBe(true);
  for (const h of ["localhost", "strata.local", "mac.tail1234.ts.net", "1password.com"]) expect(isIpAddress(h)).toBe(false);
});

test("passkey sign-in is open to a watch-only session; adding, renaming and removing aren't, nor in the demo", () => {
  expect(viewerMayCall("/passkey/generate-authenticate-options")).toBe(true);
  expect(viewerMayCall("/passkey/verify-authentication")).toBe(true);
  for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration", "/passkey/update-passkey", "/passkey/delete-passkey", "/passkey/list-user-passkeys"]) expect(viewerMayCall(path)).toBe(false);
  for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration", "/passkey/update-passkey", "/passkey/delete-passkey"]) expect(demoRefuses(path)).toBe(true);
  for (const path of ["/passkey/generate-authenticate-options", "/passkey/verify-authentication", "/passkey/list-user-passkeys"]) expect(demoRefuses(path)).toBe(false);
});

test("/api/info offers no passkeys where they can't work", async () => {
  // (A test server listens on no fixed port, so not at http://localhost either.)
  const server = await startTestServer();
  const info = (await (await server.request("/api/info")).json()) as { signIn: Record<string, unknown> };
  expect(info.signIn).toMatchObject({ passkey: false, passkeyDomain: null, passkeyAddress: null });
}, 30_000);

test("/api/info says where passkeys work", async () => {
  process.env.STRATA_PUBLIC_URL = "https://strata.example.com";
  const server = await startTestServer();
  const info = (await (await server.request("/api/info")).json()) as { signIn: Record<string, unknown> };
  expect(info.signIn).toMatchObject({ passkey: true, passkeyDomain: "strata.example.com", passkeyAddress: "https://strata.example.com" });
}, 30_000);

test("a signed-in account registers passkeys for the server's domain, and renames and removes its own", async () => {
  process.env.STRATA_PUBLIC_URL = "https://strata.example.com";
  const server = await startTestServer();
  const { token } = await setUp(server);
  const auth = (path: string, init: Parameters<typeof server.request>[1] = {}) => server.request(`/api/auth${path}`, { token, ...init, headers: { Origin: "https://strata.example.com", ...init.headers } });

  // Registration options name the server's domain (the browser then makes the passkey).
  const options = (await (await auth("/passkey/generate-register-options?name=MacBook")).json()) as { rp: { id: string; name: string }; user: { name: string } };
  expect(options.rp).toEqual({ id: "strata.example.com", name: "Strata" });
  expect(options.user.name).toBe("MacBook");
  // Signed out, there's nothing to register for.
  expect((await server.request("/api/auth/passkey/generate-register-options")).status).toBe(401);

  // A passkey the browser made (stood in for here: WebAuthn needs a real authenticator).
  const me = (await (await server.request("/api/me", { token })).json()) as { user: { id: string } };
  await server.services.db.insert(passkey).values({ id: "pk1", name: "MacBook", publicKey: "x", userId: me.user.id, credentialID: "cred1", counter: 0, deviceType: "multiDevice", backedUp: true, createdAt: new Date() });

  const list = async () => (await (await auth("/passkey/list-user-passkeys")).json()) as { id: string; name: string }[];
  expect((await list()).map((p) => p.name)).toEqual(["MacBook"]);
  expect((await auth("/passkey/update-passkey", { method: "POST", json: { id: "pk1", name: "Work laptop" } })).status).toBe(200);
  expect((await list()).map((p) => p.name)).toEqual(["Work laptop"]);
  expect((await auth("/passkey/delete-passkey", { method: "POST", json: { id: "pk1" } })).status).toBe(200);
  expect(await list()).toEqual([]);
}, 30_000);
