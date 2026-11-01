// Run by demo.test.ts in its own process: the public demo server (scripts/demo/serve.ts
// --public), as its container runs it, with TMDB stood in for and placeholder media.
import { expect } from "bun:test";
import { fakeTmdb, makeFixtures } from "../helpers";

const port = 18_461;
const media = await makeFixtures();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  return url.startsWith("https://api.themoviedb.org/") ? fakeTmdb(input, init) : realFetch(input, init);
}) as typeof fetch;
process.argv.push("--public", "--media", media, "--port", String(port));
await import("../../scripts/demo/serve");

const base = `http://127.0.0.1:${port}`;
const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return realFetch(`${base}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
};

try {
  // App Review signs in as demo / strata-demo, a member of the demo household.
  const signIn = await call("/api/auth/sign-in/username", { method: "POST", json: { username: "demo", password: "strata-demo" } });
  expect(signIn.status).toBe(200);
  const held = signIn.headers.get("set-auth-token")!;
  expect(held).toBeTruthy();
  const me = (await (await call("/api/me", { token: held })).json()) as any;
  expect(me.user.username).toBe("demo");
  expect(me.household).toMatchObject({ name: "The Demo House", role: "member" });
  expect(me.user.isServerAdmin).toBe(false);

  // Browsing works, with the library's titles.
  expect((await call("/api/home", { token: held })).status).toBe(200);
  expect((await call("/api/titles/movie/10378", { token: held })).status).toBe(200);
  expect((await call("/api/avatars")).status).toBe(200);

  // Nothing about the shared accounts or the server can change.
  expect((await call("/api/admin/settings", { token: held })).status).toBe(403);
  expect((await call("/api/auth/update-user", { method: "POST", token: held, json: { name: "Mallory" } })).status).not.toBe(200);
  expect((await call("/api/auth/change-password", { method: "POST", token: held, json: { currentPassword: "strata-demo", newPassword: "something-else" } })).status).not.toBe(200);

  // After the container restarts its sign-ins are gone (signing out stands in for that);
  // the Worker puts them back with the restore key, and the same token works again.
  await call("/api/auth/sign-out", { method: "POST", token: held, json: {} });
  expect((await call("/api/me", { token: held })).status).toBe(401);
  const token = decodeURIComponent(held).split(".")[0]!;
  const restore = (key: string) => call("/__demo/restore-session", { method: "POST", headers: { "X-Demo-Key": key }, json: { token, username: "demo", viewerOnly: false } });
  expect((await restore("not-the-key")).status).toBe(404);
  expect((await restore(process.env.DEMO_RESTORE_KEY!)).status).toBe(200);
  const back = (await (await call("/api/me", { token: held })).json()) as any;
  expect(back.user.username).toBe("demo");
  expect(back.household.name).toBe("The Demo House");

  console.log("demo scenario passed");
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
