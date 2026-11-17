import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newSetupCode } from "../src/setupCode";
import { setResolverForTests } from "../src/sources/addons";
import { fakeTmdb, startTestServer, type TestServer } from "./helpers";

/** A debrid add-on (Comet-like) whose streams are its own playback links, without torrents. */
describe("link streams", () => {
  let server: TestServer;
  let token: string;
  const followed: string[] = [];
  let keptFileId = 0;

  beforeAll(async () => {
    setResolverForTests(async () => ["93.184.215.14"]);
    const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "api.themoviedb.org") return fakeTmdb(input, init);
      if (url.hostname === "links.example") {
        if (url.pathname === "/cfg/manifest.json") return json({ id: "links", name: "Links", resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] });
        if (url.pathname.startsWith("/cfg/stream/movie/"))
          return json({
            streams: [
              { name: "Links ⚡ 1080p", title: "Big.Buck.Bunny.2008.1080p.WEB\n💾 1.2 GB", url: "https://links.example/playback/OPAQUE-1", behaviorHints: { filename: "Big.Buck.Bunny.2008.1080p.WEB.mkv", videoSize: 1_200_000_000 } },
            ],
          });
        if (url.pathname === "/playback/OPAQUE-1") {
          followed.push(url.pathname);
          return new Response(null, { status: 302, headers: { Location: "https://cdn.example/files/bbb.mkv?token=t" } });
        }
      }
      if (url.hostname === "cdn.example") return new Response("x", { status: 206 });
      return new Response("unexpected " + url, { status: 500 });
    }) as typeof fetch;
    // No TorBox key: links play without it. No ffprobe: the app reads the file.
    server = await startTestServer(fakeFetch, { ffmpeg: null, keys: { tmdbApiKey: "test-key" } });
    token = ((await (await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { setupCode: await newSetupCode(server.services.db), username: "aa", password: "password1" } })).json()) as { token: string }).token;
    expect((await server.request("/api/admin/addons", { method: "POST", token, json: { url: "https://links.example/cfg/manifest.json" } })).status).toBe(201);
  }, 60_000);

  afterAll(() => server.services.shutdown());

  test("are offered as sources, named after their add-on, without TorBox", async () => {
    const { items } = (await (await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token })).json()) as { items: { id: string; provider: string; originLabel: string; availability: string; size: number }[] };
    expect(items.map((i) => [i.id.replace(/[0-9a-f]{40}$/, "…"), i.provider, i.originLabel, i.availability, i.size])).toEqual([["link:…", "link", "Links", "cached", 1_200_000_000]]);
    // The link (which carries the add-on's settings) never leaves as data.
    expect(JSON.stringify(items)).not.toContain("OPAQUE");
  });

  test("play follows the add-on's link to the file; the app reads and plays it from there", async () => {
    const caps = { containers: ["mp4", "mov", "m4v"], videoCodecs: ["h264", "hevc"], audioCodecs: ["aac", "ac3", "eac3"], maxHeight: 2160, hdr: [], dvProfiles: [], deviceRemux: true };
    const { items } = (await (await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token })).json()) as { items: { id: string }[] };
    const ask = () => server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: items[0]!.id, caps } });
    const first = await ask();
    expect(first.status).toBe(428);
    const { needsProbe } = (await first.json()) as { needsProbe: { fileId: number; url: string } };
    expect(needsProbe.url).toBe("https://cdn.example/files/bbb.mkv?token=t");
    const info = { container: "mkv", durationMs: 596_000, video: { index: 0, codec: "h264", width: 1920, height: 1080, fps: 24, bitDepth: 8, hdr: null }, audio: [{ index: 1, codec: "aac", channels: 2, language: "eng", isDefault: true }], subtitles: [], chapters: [] };
    expect((await server.request(`/api/files/${needsProbe.fileId}/probe`, { method: "POST", token, json: info })).status).toBe(200);
    const res = await ask();
    expect(res.status).toBe(200);
    const play = (await res.json()) as { url: string; candidate: { provider: string; originLabel: string } };
    expect(play.url).toBe("https://cdn.example/files/bbb.mkv?token=t");
    expect(play.candidate.provider).toBe("link");
    // Kept in the library with its link sealed, not as an address.
    const file = (await (await server.household()).library.get(needsProbe.fileId))!;
    expect(file.provider).toBe("link");
    expect(file.ref).not.toContain("links.example");
    // Now it's the library's copy, not a discovered one.
    const again = (await (await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token })).json()) as { items: { id: string }[] };
    expect(again.items.map((i) => i.id)).toEqual([`file:${needsProbe.fileId}`]);
    expect(followed.length).toBeGreaterThan(0);
    keptFileId = needsProbe.fileId;
  });

  test("a link discovery didn't offer isn't played, and a switched-off add-on's copy doesn't play", async () => {
    expect((await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: `link:${"0".repeat(40)}` } })).status).toBe(404);
    const addons = (await (await server.request("/api/admin/addons", { token })).json()) as { items: { id: string; name: string }[] };
    const links = addons.items.find((a) => a.name === "Links")!;
    await server.request(`/api/admin/addons/${links.id}`, { method: "PATCH", token, json: { enabled: false } });
    await expect((await server.household()).playback.fileLink(keptFileId)).rejects.toThrow("switched off");
  });
});
