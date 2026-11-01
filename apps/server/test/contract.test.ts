import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startTestServer, type TestServer } from "./helpers";

/**
 * The server and the Apple apps agree on the shape of each response: the apps decode the
 * JSON in StrataKit's test fixtures, so every field a fixture has must still be in the
 * live response here. A field renamed or dropped on the server fails this test instead of
 * breaking the apps quietly. (New fields are fine: the apps ignore what they don't know.)
 */
const FIXTURES = join(import.meta.dir, "../../apple/Packages/StrataKit/Tests/StrataKitTests/Fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

const idOf = (v: unknown) => (v && typeof v === "object" && "id" in v ? (v as { id: unknown }).id : undefined);

/**
 * Paths in `expected` (the fixture) that `actual` lacks. In lists, each element is checked
 * against the live one with the same id (a shelf), or the first when they have none; one
 * the live list doesn't have (no Continue Watching on a new server) isn't checked.
 */
function missing(expected: unknown, actual: unknown, path = "$"): string[] {
  if (actual === null || actual === undefined) return [];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path} (not a list)`];
    return expected.flatMap((e, i) => {
      const id = idOf(e);
      const match = id !== undefined && actual.some((a) => idOf(a) !== undefined) ? actual.find((a) => idOf(a) === id) : actual[0];
      return missing(e, match, `${path}[${id ?? i}]`);
    });
  }
  if (expected && typeof expected === "object") {
    if (typeof actual !== "object") return [`${path} (not an object)`];
    return Object.entries(expected).flatMap(([key, value]) =>
      key in (actual as object) ? missing(value, (actual as Record<string, unknown>)[key], `${path}.${key}`) : [`${path}.${key}`],
    );
  }
  return [];
}

let server: TestServer;
let token: string;
const live = async (path: string, init: Parameters<TestServer["request"]>[1] = {}) => (await server.request(path, init)).json();

beforeAll(async () => {
  server = await startTestServer();
}, 60_000);
afterAll(() => server.services.shutdown());

test("first-run info and setup", async () => {
  expect(missing(fixture("info"), await live("/api/info"))).toEqual([]);
  const setup = await live("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "owner", password: "owner-password" } });
  expect(missing(fixture("setup"), setup)).toEqual([]);
  token = (setup as { token: string }).token;
  expect(missing(fixture("info_home"), await live("/api/info", { ip: "192.168.1.20" }))).toEqual([]);
});

test("accounts: me, households, the home-network join", async () => {
  expect(missing(fixture("me"), await live("/api/me", { token }))).toEqual([]);
  expect(missing(fixture("households"), await live("/api/auth/organization/list", { token }))).toEqual([]);
  expect(missing(fixture("join_choices"), await live("/api/join", { method: "POST", ip: "192.168.1.20", json: {} }))).toEqual([]);
});

test("catalog: home, search, titles and seasons", async () => {
  expect(missing(fixture("home"), await live("/api/home", { token }))).toEqual([]);
  expect(missing(fixture("search"), await live("/api/search?q=bunny", { token }))).toEqual([]);
  expect(missing(fixture("movie"), await live("/api/titles/movie/10378", { token }))).toEqual([]);
  expect(missing(fixture("show"), await live("/api/titles/show/9001", { token }))).toEqual([]);
  expect(missing(fixture("season"), await live("/api/titles/show/9001/seasons/1", { token }))).toEqual([]);
});
