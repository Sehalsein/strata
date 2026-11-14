import { afterAll, beforeAll, expect, test } from "bun:test";
import { setUp, startTestServer, type TestServer } from "./helpers";

let server: TestServer;
let token: string;
const json = async (res: Response) => (await res.json()) as any;

beforeAll(async () => {
  server = await startTestServer();
  ({ token } = await setUp(server));
}, 60_000);

afterAll(() => server.services.shutdown());

test("the apps report a play that failed; the household's admins see it, without TorBox keys", async () => {
  const res = await server.request("/api/play/report", {
    method: "POST",
    token,
    headers: { "X-Strata-Device-Name": "Living Room", "X-Strata-Device-Model": "AppleTV14,1" },
    json: {
      ref: "tmdb:movie:1368337",
      outcome: "failed",
      message: "Tried 2 copies and none would play here. Choose another source.",
      appVersion: "0.4.2",
      attempts: [
        {
          fileId: 447,
          copy: "2160p · Remux",
          stage: "connecting",
          error: "Could not connect to the server. https://nexus-406.ecan.tb-cdn.io/dld/x?token=secret-key",
          servers: [
            { host: "nexus-406.ecan.tb-cdn.io", error: "Could not connect to the server." },
            { host: "nexus-410.ecan.tb-cdn.io", error: "Could not connect to the server." },
          ],
        },
      ],
    },
  });
  expect(res.status).toBe(200);

  const { items } = await json(await server.request("/api/admin/play-reports", { token }));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    outcome: "failed",
    ref: "tmdb:movie:1368337",
    mediaType: "movie",
    deviceName: "Living Room",
    deviceModel: "AppleTV14,1",
    appVersion: "0.4.2",
    userName: "admin",
  });
  expect(items[0].attempts[0].servers.map((s: any) => s.host)).toEqual(["nexus-406.ecan.tb-cdn.io", "nexus-410.ecan.tb-cdn.io"]);
  expect(JSON.stringify(items)).not.toContain("secret-key");

  expect((await server.request("/api/admin/play-reports", { method: "DELETE", token })).status).toBe(200);
  expect((await json(await server.request("/api/admin/play-reports", { token }))).items).toEqual([]);
});

test("a report needs a title and an outcome", async () => {
  expect((await server.request("/api/play/report", { method: "POST", token, json: { outcome: "failed", message: "x" } })).status).toBe(400);
  expect((await server.request("/api/play/report", { method: "POST", token, json: { ref: "tmdb:movie:1", outcome: "nope", message: "x" } })).status).toBe(400);
});

test("only signed-in people report, and only admins read", async () => {
  expect((await server.request("/api/play/report", { method: "POST", json: { ref: "tmdb:movie:1", outcome: "failed", message: "x" } })).status).toBe(401);
  expect((await server.request("/api/admin/play-reports")).status).toBe(401);
});

test("the dashboard's Play asks for a file's link: admins only, and only for files that exist", async () => {
  expect((await server.request("/api/admin/files/999999/play-link", { method: "POST", token })).status).toBe(404);
  expect((await server.request("/api/admin/files/1/play-link", { method: "POST" })).status).toBe(401);
});
