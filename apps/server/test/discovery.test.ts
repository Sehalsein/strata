import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseSize, rankReleases, relevant, type Release } from "../src/sources/discovery";
import { parseFileName } from "../src/media/parse";
import { fakeTmdb, makeFixtures, startTestServer, type TestServer } from "./helpers";

const release = (title: string, over: Partial<Release> = {}): Release => ({
  hash: title,
  title,
  origin: "torbox",
  cached: false,
  parsed: parseFileName(title),
  isPack: false,
  ...over,
});

describe("release filtering", () => {
  const ep = { mediaType: "episode" as const, tmdbId: 1, season: 2, episode: 3 };

  test("episodes, packs and ranges", () => {
    expect(relevant(release("Show.S02E03.1080p.WEB"), ep)).toBe(true);
    expect(relevant(release("Show.S02E04.1080p.WEB"), ep)).toBe(false);
    expect(relevant(release("Show.S02.1080p.BluRay"), ep)).toBe(true);
    expect(relevant(release("Show Season 2 Complete 720p"), ep)).toBe(true);
    expect(relevant(release("Show.S01-S04.1080p"), ep)).toBe(true);
    expect(relevant(release("Show.S03.1080p"), ep)).toBe(false);
    expect(relevant(release("Show.S02E01-E05.1080p"), ep)).toBe(true);
  });

  test("movies drop cams and episodes", () => {
    const movie = { mediaType: "movie" as const, tmdbId: 1 };
    expect(relevant(release("Film.2024.1080p.WEB-DL"), movie)).toBe(true);
    expect(relevant(release("Film.2024.HDCAM.x264"), movie)).toBe(false);
    expect(relevant(release("Film.S01E01.1080p"), movie)).toBe(false);
  });

  test("cached first, then quality within limits", () => {
    const ranked = rankReleases(
      [
        release("A.2160p.REMUX", { size: 80 * 1024 ** 3 }),
        release("B.1080p.WEB", { cached: true }),
        release("C.2160p.WEB", { cached: true, size: 20 * 1024 ** 3 }),
        release("D.2160p.BluRay", { cached: true, size: 60 * 1024 ** 3 }),
      ],
      { maxResolution: 2160, maxReleaseSizeGb: 40 },
    );
    expect(ranked.map((r) => r.title[0])).toEqual(["C", "B", "D", "A"]);
  });

  test("torrentio sizes", () => {
    expect(parseSize("👤 31 💾 14.2 GB ⚙️ ThePirateBay")).toBe(Math.round(14.2 * 1024 ** 3));
    expect(parseSize("no size")).toBeUndefined();
  });
});

describe("discovery end to end", () => {
  const CACHED = "a".repeat(40);
  const UNCACHED = "b".repeat(40);
  let server: TestServer;
  let cdn: ReturnType<typeof Bun.serve>;
  let token: string;
  const torrents: { id: number; hash: string; name: string; download_present: boolean; progress: number; files: { id: number; name: string; size: number }[] }[] = [];

  beforeAll(async () => {
    const media = await makeFixtures();
    const moviePath = join(media, "Movies/Big Buck Bunny (2008)/Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv");
    // Stands in for TorBox's CDN.
    cdn = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(moviePath)) });

    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "api.themoviedb.org") return fakeTmdb(input, init);
      if (url.hostname === "torrentio.strem.fun") {
        expect(url.pathname).toBe("/stream/movie/tt1254207.json");
        return json({
          streams: [
            { name: "Torrentio\n1080p", title: "Big.Buck.Bunny.2008.1080p.BluRay.x264\n👤 50 💾 1.2 GB ⚙️ YTS", infoHash: CACHED.toUpperCase(), behaviorHints: { filename: "Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv" } },
            { name: "Torrentio\n4k", title: "Big.Buck.Bunny.2008.2160p.WEB\n👤 3 💾 8 GB", infoHash: UNCACHED },
            { name: "Torrentio\n720p", title: "Big.Buck.Bunny.2008.HDCAM\n👤 900", infoHash: "c".repeat(40) },
          ],
        });
      }
      if (url.hostname === "search-api.torbox.app") return json({ data: { torrents: [] } });
      if (url.hostname === "api.torbox.app") {
        const path = url.pathname.replace("/v1/api", "");
        if (path === "/torrents/checkcached") {
          const { hashes } = JSON.parse(String(init?.body)) as { hashes: string[] };
          return json({ success: true, data: Object.fromEntries(hashes.filter((h) => h === CACHED).map((h) => [h, { hash: h, name: "Big Buck Bunny", size: 1 }])) });
        }
        if (path === "/torrents/createtorrent") {
          const magnet = (init?.body as FormData).get("magnet") as string;
          const hash = /btih:([a-f0-9]+)/i.exec(magnet)![1]!.toLowerCase();
          const id = torrents.length + 1;
          const ready = hash === CACHED;
          torrents.push({ id, hash, name: "Big.Buck.Bunny.2008.1080p.BluRay.x264", download_present: ready, progress: ready ? 1 : 0.1, files: ready ? [{ id: 0, name: "Big.Buck.Bunny.2008.1080p.BluRay.x264/Big.Buck.Bunny.2008.1080p.BluRay.x264.mkv", size: 1000 }] : [] });
          return json({ success: true, data: { torrent_id: id, hash } });
        }
        if (path === "/torrents/mylist") {
          const id = url.searchParams.get("id");
          return json({ success: true, data: id ? torrents.find((t) => t.id === Number(id)) : torrents });
        }
        if (path === "/torrents/requestdl") return json({ success: true, data: `http://127.0.0.1:${cdn.port}/file.mkv` });
        if (path.endsWith("/mylist")) return json({ success: true, data: [] });
      }
      return new Response("unexpected " + url, { status: 500 });
    }) as typeof fetch;

    process.env.TORBOX_API_KEY = "tb-test";
    server = await startTestServer(fakeFetch);
    token = ((await (await server.request("/api/setup/admin", { method: "POST", json: { username: "a", password: "password1" } })).json()) as { token: string }).token;
  }, 60_000);

  afterAll(() => {
    server.services.shutdown();
    cdn.stop(true);
    delete process.env.TORBOX_API_KEY;
  });

  test("sources lists cached releases first and drops cams", async () => {
    const res = await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token });
    const { items } = (await res.json()) as { items: { id: string; availability: string; size: number }[] };
    expect(items.map((i) => [i.id, i.availability])).toEqual([
      [`hash:${CACHED}`, "cached"],
      [`hash:${UNCACHED}`, "uncached"],
    ]);
    expect(items[0]!.size).toBe(Math.round(1.2 * 1024 ** 3));
  });

  test("play with nothing in the library adds the cached release and remuxes it", async () => {
    const res = await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378 } });
    expect(res.status).toBe(200);
    const play = (await res.json()) as { mode: string; url: string; sessionId: string; candidate: { provider: string } };
    expect(play.mode).toBe("remux");
    expect(play.candidate.provider).toBe("torbox");
    const segment = await server.request(play.url.replace("stream.m3u8", "seg00000.m4s"));
    expect(segment.status).toBe(200);
    server.services.sessions.stop(play.sessionId);
    // The release is now part of the library and no longer "discovered".
    const { items } = (await (await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token })).json()) as { items: { id: string }[] };
    expect(items[0]!.id).toMatch(/^file:/);
    expect(items.some((i) => i.id === `hash:${CACHED}`)).toBe(false);
  }, 60_000);

  test("an uncached release reports download progress", async () => {
    const res = await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: `hash:${UNCACHED}` } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "downloading", progress: 0.1 });
    // Asking again doesn't add a second copy.
    await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: `hash:${UNCACHED}` } });
    expect(torrents.filter((t) => t.hash === UNCACHED)).toHaveLength(1);
  }, 60_000);
});
