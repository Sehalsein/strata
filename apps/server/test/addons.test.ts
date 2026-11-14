import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { addonStreams, AddonError, inspectAddon, manifestUrl, type StreamAddon } from "../src/sources/addons";
import { fakeTmdb, startTestServer, type TestServer } from "./helpers";

const H = (c: string) => c.repeat(40);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const addon = (over: Partial<StreamAddon> = {}): StreamAddon => ({ id: "x", url: "https://addon.example/cfg/manifest.json", name: "Addon", enabled: true, idPrefixes: null, kind: "stremio", configurable: false, ...over });

describe("add-on addresses", () => {
  test("pasted addresses become manifest URLs", () => {
    expect(manifestUrl("stremio://torrentio.strem.fun/manifest.json")).toBe("https://torrentio.strem.fun/manifest.json");
    expect(manifestUrl(" https://torrentio.strem.fun/ ")).toBe("https://torrentio.strem.fun/manifest.json");
    expect(() => manifestUrl("torrentio.strem.fun")).toThrow(AddonError);
  });

  test("a manifest that finds movie or show streams is accepted; AIOStreams is recognised", async () => {
    const manifests: Record<string, unknown> = {
      "/manifest.json": { id: "com.stremio.torrentio.addon", name: "Torrentio", resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt", "kitsu"], behaviorHints: { configurable: true } },
      "/stremio/u-1/enc%3Apw/manifest.json": { id: "com.aiostreams.viren070", name: "AIOStreams", resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }], types: [] },
      "/catalog/manifest.json": { id: "cat", name: "Catalogs", resources: ["catalog", "meta"], types: ["movie"] },
    };
    const fetchImpl = (async (input: string) => {
      const m = manifests[new URL(input).pathname];
      return m ? json(m) : new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    expect(await inspectAddon("https://t.example", fetchImpl)).toEqual({ url: "https://t.example/manifest.json", name: "Torrentio", idPrefixes: ["tt", "kitsu"], kind: "stremio", configurable: true });
    expect(await inspectAddon("https://a.example/stremio/u-1/enc%3Apw/manifest.json", fetchImpl)).toMatchObject({ name: "AIOStreams", idPrefixes: ["tt"], kind: "aiostreams" });
    await expect(inspectAddon("https://c.example/catalog/manifest.json", fetchImpl)).rejects.toThrow("doesn't find streams");
    await expect(inspectAddon("https://c.example/missing", fetchImpl)).rejects.toThrow("answered 404");
  });
});

describe("add-on streams", () => {
  test("hashes come from infoHash, AIOStreams' streamData, or a debrid link; others are dropped", async () => {
    const fetchImpl = (async (input: string) => {
      expect(new URL(input).pathname).toBe("/cfg/stream/series/tt1:2:3.json");
      return json({
        streams: [
          { name: "Torrentio\n1080p", title: "Show.S02E03.1080p.WEB\n👤 12 💾 1.5 GB", infoHash: H("A"), behaviorHints: { filename: "Show.S02E03.1080p.WEB.mkv" } },
          { name: "[TB+] Torrentio\n4k", title: "Show.S02.2160p.WEB\nShow.S02E03.2160p.WEB.mkv\n👤 4 💾 9 GB", url: `https://torrentio.example/resolve/torbox/KEY/${H("b")}/null/3/Show.S02E03.2160p.WEB.mkv` },
          { name: "AIO 720p", description: "formatted", url: "https://aio.example/playback/opaque", streamData: { filename: "Show.S02E03.720p.mkv", folderName: "Show.S02.720p", size: 700, torrent: { infoHash: H("c"), seeders: 5 } } },
          { name: "Web", title: "A plain link", url: "https://cdn.example/video.mp4" },
        ],
      });
    }) as unknown as typeof fetch;
    const streams = await addonStreams(addon(), "series", "tt1:2:3", fetchImpl);
    expect(streams).toEqual([
      { hash: H("a"), title: "Show.S02E03.1080p.WEB", fileName: "Show.S02E03.1080p.WEB.mkv", size: Math.round(1.5 * 1024 ** 3), seeders: 12, resolution: 1080 },
      { hash: H("b"), title: "Show.S02.2160p.WEB", fileName: "Show.S02E03.2160p.WEB.mkv", size: 9 * 1024 ** 3, seeders: 4, resolution: 2160 },
      { hash: H("c"), title: "Show.S02.720p", fileName: "Show.S02E03.720p.mkv", size: 700, seeders: 5, resolution: 720 },
    ]);
  });

  test("AIOStreams is asked through its search API with the URL's uuid and password, falling back to Stremio's", async () => {
    const asked: string[] = [];
    let searchOn = true;
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      asked.push(url.pathname);
      if (url.pathname === "/api/v1/search") {
        if (!searchOn) return json({ success: false, error: { message: "Search API is disabled" } }, 403);
        expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa("u-1:enc:pw")}`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ type: "movie", id: "tt9", requiredFields: "infoHash" });
        return json({
          success: true,
          data: { results: [{ infoHash: H("D"), filename: "Film.2024.2160p.mkv", folderName: null, size: 4000, folderSize: null, seeders: null, parsedFile: { resolution: "2160p" } }] },
        });
      }
      return json({ streams: [{ infoHash: H("e"), title: "Film.2024.1080p" }] });
    }) as unknown as typeof fetch;
    const aio = addon({ url: "https://aio.example/stremio/u-1/enc%3Apw/manifest.json", kind: "aiostreams" });

    expect(await addonStreams(aio, "movie", "tt9", fetchImpl)).toEqual([{ hash: H("d"), title: "Film.2024.2160p.mkv", fileName: "Film.2024.2160p.mkv", size: 4000, seeders: undefined, resolution: 2160 }]);
    searchOn = false;
    expect((await addonStreams(aio, "movie", "tt9", fetchImpl)).map((s) => s.hash)).toEqual([H("e")]);
    expect(asked).toEqual(["/api/v1/search", "/api/v1/search", "/stremio/u-1/enc%3Apw/stream/movie/tt9.json"]);
  });
});

describe("add-ons in the dashboard", () => {
  let server: TestServer;
  let token: string;

  beforeAll(async () => {
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "comet.example") return json({ id: "comet", name: "Comet", resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] });
      return fakeTmdb(input, init);
    }) as typeof fetch;
    server = await startTestServer(fetchImpl, { ffmpeg: null });
    token = ((await (await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "aa", password: "password1" } })).json()) as { token: string }).token;
  }, 60_000);

  afterAll(() => server.services.shutdown());

  test("starts with the server's Torrentio; add, turn off, move and remove; URLs never come back", async () => {
    const list = async () => ((await (await server.request("/api/admin/addons", { token })).json()) as { items: { id: string; name: string; host: string; enabled: boolean; isDefault: boolean }[] }).items;
    expect(await list()).toEqual([expect.objectContaining({ id: "default", name: "Torrentio", host: "torrentio.strem.fun", enabled: true, isDefault: true })]);

    const added = await server.request("/api/admin/addons", { method: "POST", token, json: { url: "https://comet.example/SECRET-CONFIG/manifest.json" } });
    expect(added.status).toBe(201);
    const comet = (await added.json()) as { id: string };
    expect(JSON.stringify(await list())).not.toContain("SECRET-CONFIG");

    const again = await server.request("/api/admin/addons", { method: "POST", token, json: { url: "https://comet.example/SECRET-CONFIG" } });
    expect(again.status).toBe(400);

    await server.request(`/api/admin/addons/${comet.id}`, { method: "PATCH", token, json: { enabled: false, index: 0 } });
    expect((await list()).map((a) => [a.name, a.enabled])).toEqual([["Comet", false], ["Torrentio", true]]);

    // Configure redirects to the add-on's own page; the URL never comes back as data.
    const configure = await server.request("/api/admin/addons/default/configure", { token, redirect: "manual" });
    expect(configure.status).toBe(302);
    expect(configure.headers.get("Location")).toBe("https://torrentio.strem.fun/configure");

    // Edit points it elsewhere, in the same place and with the same switch.
    const edited = await server.request(`/api/admin/addons/${comet.id}`, { method: "PATCH", token, json: { url: "https://comet.example/OTHER" } });
    expect(edited.status).toBe(200);
    expect((await list()).map((a) => [a.name, a.enabled])).toEqual([["Comet", false], ["Torrentio", true]]);
    expect((await server.request("/api/admin/addons/default", { method: "PATCH", token, json: { url: "https://nowhere.example" } })).status).toBe(400);

    const refreshed = (await (await server.request("/api/admin/addons/refresh", { method: "POST", token })).json()) as { failed: string[] };
    expect(refreshed.failed).toEqual(["Torrentio"]); // the test's fetch has no Torrentio

    await server.request("/api/admin/addons", { method: "DELETE", token });
    // An empty list stays empty: it doesn't fall back to Torrentio.
    expect(await list()).toEqual([]);
    expect((await server.request("/api/admin/addons/nope", { method: "DELETE", token })).status).toBe(404);
  });
});
