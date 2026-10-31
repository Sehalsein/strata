import { expect, test } from "bun:test";
import { deploymentProfile } from "../src/profile";
import { startTestServer } from "./helpers";

const json = async (res: Response) => (await res.json()) as any;

test("the profile answers what each kind of server does", () => {
  const home = deploymentProfile("home", "bun");
  expect(home).toMatchObject({ firstRunSetup: true, homeNetworkJoin: true, localMedia: true, selfUpdate: true, scheduler: "timers", openSignUp: false });
  // The cloud server in a container: no self-update, but its own timers run the jobs.
  expect(deploymentProfile("cloud", "bun")).toMatchObject({ selfUpdate: false, scheduler: "timers", sharedJobHistory: true, homeNetworkJoin: false, openSignUp: true });
  // On Workers, Cron Triggers run them.
  expect(deploymentProfile("cloud", "workers")).toMatchObject({ selfUpdate: false, scheduler: "cron", localMedia: false });
});

test("a cloud server runs in this process too: no setup, no updates, capabilities published", async () => {
  // A cloud server keeps no key file: its key comes from the environment.
  process.env.STRATA_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
  const server = await startTestServer(undefined, { profile: deploymentProfile("cloud", "workers") });
  try {
    const info = await json(await server.request("/api/info"));
    expect(info).toMatchObject({ mode: "cloud", setupRequired: false, capabilities: { localMedia: false, homeNetworkJoin: false, selfUpdate: false, openSignUp: true } });
    expect((await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "x", password: "x-password" } })).status).toBe(404);
    expect((await server.request("/api/join", { method: "POST", ip: "192.168.1.5", json: {} })).status).toBe(403);
    expect(server.services.updater.status().disabledReason).toContain("deploying");
    // Cron Triggers say when each job runs next; local folders and backups aren't jobs here.
    const jobs = await server.services.jobs.statusNow();
    expect(jobs.map((j) => j.name)).not.toContain("scanLocal");
    expect(jobs.find((j) => j.name === "pruneAuth")!.nextRunAt).toBeGreaterThan(Date.now());
  } finally {
    server.services.shutdown();
    delete process.env.STRATA_SECRET_KEY;
  }
});

test("the demo is read-only once it's set up, for everyone", async () => {
  const server = await startTestServer();
  try {
    const setup = await json(await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "admin", password: "test-password" } }));
    server.services.profile.readOnly = true;
    const me = await json(await server.request("/api/me", { token: setup.token }));
    expect(me.permissions).toEqual({ administerHousehold: false, administerServer: false, change: false });
    expect((await server.request("/api/admin/settings", { method: "PATCH", token: setup.token, json: {} })).status).toBe(403);
    expect((await server.request("/api/auth/organization/invite-member", { method: "POST", token: setup.token, json: { email: "x@example.com", role: "member" } })).status).toBe(403);
    expect((await json(await server.request("/api/info"))).capabilities.readOnly).toBe(true);
  } finally {
    server.services.shutdown();
  }
});
