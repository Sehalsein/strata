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

  // Someone invited signs up and in straight away, from the invitation's link (the proof):
  // no email first. Their address stays unconfirmed until they confirm it.
  const token = (await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ann", password: "a-good-password" } })).headers.get("set-auth-token")!;
  const invite = await json(await req("/api/auth/organization/invite-member", { method: "POST", token, json: { email: "ben@example.com", role: "member" } }));
  const mailed = sent.length;
  const ben = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "ben@example.com", password: "a-good-password", name: "Ben", username: "ben", invitationId: invite.id } });
  expect(ben.status).toBe(200);
  const benToken = ben.headers.get("set-auth-token")!;
  expect(benToken).toBeTruthy();
  expect(sent).toHaveLength(mailed); // asked in the app instead
  expect((await req("/api/auth/organization/accept-invitation", { method: "POST", token: benToken, json: { invitationId: invite.id } })).status).toBe(200);
  const benMe = await json(await req("/api/me", { token: benToken }));
  expect(benMe.household).toMatchObject({ name: "Ann's home", role: "member" });
  expect(benMe.user.emailVerified).toBe(false);
  // …signing in again works, by username or email, and sends nothing.
  expect((await req("/api/auth/sign-in/username", { method: "POST", json: { username: "ben", password: "a-good-password" } })).status).toBe(200);
  expect((await req("/api/auth/sign-in/email", { method: "POST", json: { email: "ben@example.com", password: "a-good-password" } })).status).toBe(200);
  expect(sent).toHaveLength(mailed);
  // When the app asks them to, they confirm it, and only then is it confirmed.
  expect((await req("/api/auth/send-verification-email", { method: "POST", token: benToken, json: { email: "ben@example.com" } })).status).toBe(200);
  const benMail = sent.at(-1)!;
  expect(benMail).toMatchObject({ to: ["ben@example.com"], subject: "Confirm your email for Strata" });
  expect(benMail.text).not.toContain("finish making your account");
  const benLink = new URL(linkIn(benMail.text));
  await req(`${benLink.pathname}${benLink.search}`, { redirect: "manual" });
  expect((await json(await req("/api/me", { token: benToken }))).user.emailVerified).toBe(true);

  // An account made without an invitation still confirms first, by email sign-in too.
  const early2 = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "cal@example.com", password: "a-good-password", name: "Cal", username: "cal" } });
  expect(early2.headers.get("set-auth-token")).toBeNull();
  const before = sent.length;
  expect((await req("/api/auth/sign-in/email", { method: "POST", json: { email: "cal@example.com", password: "a-good-password" } })).status).toBe(403);
  expect(sent).toHaveLength(before + 1);
  expect(linkIn(sent.at(-1)!.text)).toStartWith("http");
  // …and a wrong password there is just wrong, and sends nothing.
  expect((await req("/api/auth/sign-in/email", { method: "POST", json: { email: "cal@example.com", password: "not-the-password" } })).status).toBe(401);
  expect(sent).toHaveLength(before + 1);

  // Registering someone else's address with an invitation of one's own signs in, but the
  // address stays unconfirmed: it can't list the invitations sent to that address (taking one
  // up needs its link), and doesn't count as that address for anything that needs it confirmed.
  const eveSignUp = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "eve@example.com", password: "a-good-password", name: "Eve", username: "eve", callbackURL: "/" } });
  expect(eveSignUp.status).toBe(200);
  const eveLink = new URL(linkIn(sent.filter((e) => String(e.to) === "eve@example.com").at(-1)!.text));
  await req(`${eveLink.pathname}${eveLink.search}`, { redirect: "manual" });
  const eve = (await req("/api/auth/sign-in/username", { method: "POST", json: { username: "eve", password: "a-good-password" } })).headers.get("set-auth-token")!;
  const lure = await json(await req("/api/auth/organization/invite-member", { method: "POST", token: eve, json: { email: "victim@example.com", role: "member" } }));
  const squat = await req("/api/auth/sign-up/email", { method: "POST", json: { email: "victim@example.com", password: "eves-password", name: "V", username: "notvictim", invitationId: lure.id } });
  const squatToken = squat.headers.get("set-auth-token")!;
  expect((await json(await req("/api/me", { token: squatToken }))).user.emailVerified).toBe(false);
  await req("/api/auth/organization/invite-member", { method: "POST", token, json: { email: "victim@example.com", role: "member" } });
  expect((await req("/api/auth/organization/list-user-invitations", { token: squatToken })).status).toBe(403);

  console.log("cloud email scenario passed");
  server.services.shutdown();
  process.exit(0);
} catch (err) {
  console.error(err, sent);
  process.exit(1);
}
