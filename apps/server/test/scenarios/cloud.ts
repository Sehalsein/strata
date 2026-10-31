// Run by cloud.test.ts in its own process: the mode is fixed when the server's modules load.
import { expect } from "bun:test";
import { startTestServer } from "../helpers";

const server = await startTestServer();
const json = async (res: Response) => (await res.json()) as any;
let ip = 0;
const signUp = (email: string, username: string, invitationId?: string) =>
  server.request("/api/auth/sign-up/email", { method: "POST", ip: `203.0.113.${++ip}`, json: { email, password: "a-good-password", name: username, username, invitationId } });

try {
  // No setup: the dashboard opens on sign-in, and anyone may make an account.
  const info = await json(await server.request("/api/info"));
  expect(info).toMatchObject({ mode: "cloud", setupRequired: false, signIn: { signUp: true } });
  expect((await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "x", password: "long-enough" } })).status).toBe(404);

  // A new account owns a new household, and its sign-in opens there.
  const ann = await signUp("ann@example.com", "ann");
  expect(ann.status).toBe(200);
  const annToken = ann.headers.get("set-auth-token")!;
  const annMe = await json(await server.request("/api/me", { token: annToken }));
  expect(annMe.user).toMatchObject({ username: "ann", isServerAdmin: false });
  expect(annMe.household).toMatchObject({ name: "ann's home", role: "owner" });
  // …just the one: a second household isn't theirs to make.
  expect((await server.request("/api/auth/organization/create", { method: "POST", token: annToken, json: { name: "Another", slug: "another-x" } })).status).not.toBe(200);

  // Someone invited joins that household instead of getting one of their own.
  const invite = await json(await server.request("/api/auth/organization/invite-member", { method: "POST", token: annToken, json: { email: "ben@example.com", role: "member" } }));
  const ben = await signUp("ben@example.com", "ben", invite.id);
  expect(ben.status).toBe(200);
  const benToken = ben.headers.get("set-auth-token")!;
  expect((await server.request("/api/auth/organization/accept-invitation", { method: "POST", token: benToken, json: { invitationId: invite.id } })).status).toBe(200);
  const benMe = await json(await server.request("/api/me", { token: benToken }));
  expect(benMe.household).toMatchObject({ name: "ann's home", role: "member" });
  expect(await server.services.householdIds()).toHaveLength(1);
  // A made-up invitation still opens nothing.
  expect((await signUp("cat@example.com", "cat", "not-an-invitation")).status).toBe(403);

  // The emails in STRATA_ADMIN_EMAILS run the server.
  const boss = await signUp("Boss@Example.com", "boss");
  const bossMe = await json(await server.request("/api/me", { token: boss.headers.get("set-auth-token")! }));
  expect(bossMe.user.isServerAdmin).toBe(true);
  console.log("cloud scenario passed");
  server.services.shutdown();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
