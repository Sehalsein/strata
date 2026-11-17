import { describe, expect, test } from "bun:test";
import { classify } from "../src/classify";

const kind = (method: string, path: string) => classify(method, new URL(`https://demo.test${path}`));

describe("the demo answers what the apps need", () => {
  test.each([
    ["GET", "/api/home/catalog", "api"],
    ["GET", "/api/home/profile", "api"],
    ["GET", "/api/movies", "api"],
    ["GET", "/api/shows", "api"],
    ["GET", "/api/watchlist", "api"],
    ["GET", "/api/titles/tmdb:movie:16093", "api"],
    ["GET", "/api/titles/tmdb:show:1018/seasons/1", "api"],
    ["GET", "/api/rows/home/because%3Amovie%3A27205", "api"],
    ["GET", "/api/rows/movies/movies-spotlight", "api"],
    ["GET", "/api/subtitles/abc_DEF-123.vtt", "api"],
    ["POST", "/api/play", "play"],
    ["POST", "/api/play/pick", "api"],
    ["POST", "/api/play/report", "api"],
    ["PUT", "/api/reminders", "api"],
    ["DELETE", "/api/continue/tmdb:movie:16093", "api"],
    ["GET", "/api/stream/f84bd438eabfa1f2755fd3343be81387/file", "stream"],
    ["GET", "/api/files/9/content", "stream"],
  ])("%s %s", (method, path, expected) => {
    expect(kind(method, path)).toBe(expected as ReturnType<typeof classify>);
  });
});

describe("and refuses the rest", () => {
  test.each([
    ["GET", "/api/admin/settings"],
    ["POST", "/api/setup/admin"],
    ["POST", "/api/join"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/change-password"],
    ["GET", "/api/me/export"],
    ["GET", "/api/files/9/content/../../etc"],
    ["GET", "/api/rows/home/a/b"],
    ["POST", "/api/rows/home/x"],
  ])("%s %s", (method, path) => {
    expect(kind(method, path)).toBeNull();
  });

  test("release search", () => {
    expect(kind("GET", "/api/sources?discover=1")).toBeNull();
  });
});
