import { afterAll, beforeAll, expect, test } from "bun:test";
import { files, mediaItems, profiles, progress } from "../src/db/schema";
import { startTestServer, type TestServer } from "./helpers";

let server: TestServer;
let token: string;
beforeAll(async () => {
  server = await startTestServer();
  const setup = await server.request("/api/setup/admin", { method: "POST", json: { username: "admin", password: "test-password" } });
  token = (await setup.json() as { token: string }).token;
  const db = server.services.db;
  db.insert(profiles).values({ id: 2, name: "Second" }).run();
  db.insert(mediaItems).values([
    { type: "movie", tmdbId: 1, title: "A Different Title", year: 2020 },
    { type: "show", tmdbId: 2, title: "Sample Show", year: 2024 },
  ]).run();
  db.insert(files).values([
    { id: 1, provider: "local", ref: "/movies/Zebra_100%.mkv", name: "Zebra_100%.mkv", size: 10, mediaType: "movie", tmdbId: 1, matchStatus: "matched", addedAt: 100 },
    { id: 2, provider: "torbox", ref: "torrents:1:1", name: "alpha.S01E01.mkv", size: 30, mediaType: "episode", tmdbId: 2, season: 1, episode: 1, matchStatus: "matched", addedAt: 300, mtime: 50 },
    { id: 3, provider: "local", ref: "/shows/beta.mkv", name: "beta.S01E02.mkv", size: 20, mediaType: "episode", tmdbId: 2, season: 1, episode: 2, matchStatus: "manual", addedAt: 200 },
    { id: 4, provider: "local", ref: "/new/unknown.mkv", name: "unknown.mkv", size: 20, parsedJson: JSON.stringify({ kind: "movie", title: "Unmatched Film" }), addedAt: 400 },
    { id: 5, provider: "local", ref: "/missing.mkv", name: "missing.mkv", size: 99, missing: true },
  ]).run();
  db.insert(progress).values([
    { profileId: 1, mediaType: "movie", tmdbId: 1, positionMs: 10, durationMs: 100, updatedAt: 1000 },
    { profileId: 2, mediaType: "movie", tmdbId: 1, positionMs: 20, durationMs: 100, updatedAt: 3000 },
    { profileId: 1, mediaType: "episode", tmdbId: 2, season: 1, episode: 1, positionMs: 10, durationMs: 100, updatedAt: 2000 },
  ]).run();
});
afterAll(() => server.services.shutdown());
async function list(query = "") {
  const response = await server.request(`/api/admin/files?${query}`, { token });
  expect(response.status).toBe(200);
  return await response.json() as { total: number; items: { fileId: number; lastAccessedAt: number | null; addedAt: number }[] };
}
const ids = (r: Awaited<ReturnType<typeof list>>) => r.items.map((f) => f.fileId);

test("last accessed uses latest profile activity, isolates episodes, and sorts before pagination", async () => {
  const result = await list("limit=1&offset=0");
  expect(result.total).toBe(4);
  expect(result.items[0]).toMatchObject({ fileId: 1, lastAccessedAt: 3000 });
  expect(ids(await list("limit=1&offset=1"))).toEqual([2]);
  expect(ids(await list("sort=lastAccessed&direction=asc"))).toEqual([2, 1, 3, 4]);
  expect((await list("accessed=no")).items.every((f) => f.lastAccessedAt === null)).toBe(true);
  expect(ids(await list("accessed=no"))).toEqual([3, 4]);
});
test("searches matched titles, filenames, paths, and parsed titles with literal punctuation", async () => {
  expect(ids(await list("q=different%20title"))).toEqual([1]);
  expect(ids(await list("q=100%25"))).toEqual([1]);
  expect(ids(await list("q=%2Fmovies%2F"))).toEqual([1]);
  expect(ids(await list("q=unmatched%20film&searchIn=title"))).toEqual([4]);
  expect((await list("q=different&searchIn=filename")).total).toBe(0);
  expect(ids(await list("q=ALPHA&searchIn=filename"))).toEqual([2]);
});
test("combines source, match, type and activity filters without changing counts", async () => {
  expect(ids(await list("q=sample&provider=local&status=manual&mediaType=episode&accessed=no"))).toEqual([3]);
  expect(ids(await list("mediaType=movie&accessed=no"))).toEqual([4]);
  expect((await list("q=sample&limit=1")).total).toBe(2);
  expect((await list("q=missing")).total).toBe(0);
});
test("supports stable name, title, size, year, and actual added-date ordering", async () => {
  expect(ids(await list("sort=name&direction=asc"))).toEqual([2, 3, 4, 1]);
  expect(ids(await list("sort=title&direction=asc"))).toEqual([1, 2, 3, 4]);
  expect(ids(await list("sort=size&direction=desc"))).toEqual([2, 3, 4, 1]);
  expect(ids(await list("sort=year&direction=asc"))).toEqual([1, 2, 3, 4]);
  expect(ids(await list("sort=added&direction=desc"))).toEqual([4, 3, 1, 2]);
  expect((await list("sort=added")).items.find((f) => f.fileId === 2)?.addedAt).toBe(50);
});
test("validates query options and retains admin authentication", async () => {
  for (const query of ["sort=invalid", "direction=sideways", "searchIn=secrets", "mediaType=invalid", "accessed=maybe", `q=${"x".repeat(201)}`]) {
    expect((await server.request(`/api/admin/files?${query}`, { token })).status).toBe(400);
  }
  expect((await server.request("/api/admin/files?sort=lastAccessed")).status).toBe(401);
});
