// Run by cloud.test.ts in its own process: the cloud with email set up, so new accounts
// confirm their address. Resend is stood in for; the emails it would send are kept here.
import { expect } from "bun:test";
import { startTestServer, fakeTmdb } from "../helpers";

const sent: { to: string; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/")) {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "email" });
  }
  return realFetch(input, init);
}) as typeof fetch;

const server = await startTestServer(fakeTmdb);
const json = async (res: Response) => (await res.json()) as any;
const linkIn = (text: string) => /https?:\/\/\S+verify-email\S+/.exec(text)![0];
let ip = 0;
const req = (path: string, init: Parameters<typeof server.request>[1] = {}) => server.request(path, { ip: `203.0.113.${++ip}`, ...init });

try {
  expect((await json(await req("/api/info"))).signIn).toMatchObject({ signUp: true, confirmEmail: true });

  // Signing up makes the account and its household, but no sign-in: first, the email.
  const signUp = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "ann@example.com", password: "a-good-password", name: "Ann", username: "ann", callbackURL: "/?welcome=1" } });
  expect(signUp.status).toBe(200);
  expect(signUp.headers.get("set-auth-token")).toBeNull();
  expect(sent.at(-1)).toMatchObject({ to: ["ann@example.com"], subject: "Confirm your email for Strata" });
  expect(await server.services.householdIds()).toHaveLength(1);

  // Signing in before confirming is refused, and sends a fresh link.
  const early = await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ann", password: "a-good-password" } });
  expect(early.status).toBe(403);
  expect(sent).toHaveLength(2);

  // The link confirms the address and signs in, in the account's household.
  const link = new URL(linkIn(sent.at(-1)!.text));
  const confirmed = await req(`${link.pathname}${link.search}`, { redirect: "manual" });
  expect([200, 302]).toContain(confirmed.status);
  const cookie = confirmed.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await json(await req("/api/me", { headers: { cookie } }));
  expect(me.household).toMatchObject({ name: "Ann's home", role: "owner" });
  expect((await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ann", password: "a-good-password" } })).status).toBe(200);

  // Someone invited signs up and is in straight away: the invitation went to that address.
  const token = (await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ann", password: "a-good-password" } })).headers.get("set-auth-token")!;
  const invite = await json(await req("/api/auth/organization/invite-member", { method: "POST", token, json: { email: "ben@example.com", role: "member" } }));
  const ben = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "ben@example.com", password: "a-good-password", name: "Ben", username: "ben", invitationId: invite.id } });
  expect(ben.status).toBe(200);
  const benIn = await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ben", password: "a-good-password" } });
  expect(benIn.status).toBe(200);
  const benToken = benIn.headers.get("set-auth-token")!;
  expect((await req("/api/auth/organization/accept-invitation", { method: "POST", token: benToken, json: { invitationId: invite.id } })).status).toBe(200);
  expect((await json(await req("/api/me", { token: benToken }))).household).toMatchObject({ name: "Ann's home", role: "member" });
  expect(sent.filter((e) => String(e.to) === "ben@example.com")).toHaveLength(0);

  console.log("cloud email scenario passed");
  server.services.shutdown();
  process.exit(0);
} catch (err) {
  console.error(err, sent);
  process.exit(1);
}
