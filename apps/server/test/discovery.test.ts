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
  const ep = { source: "tmdb" as const, mediaType: "episode" as const, titleId: 1, season: 2, episode: 3 };

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
    const movie = { source: "tmdb" as const, mediaType: "movie" as const, titleId: 1 };
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

    // No ffprobe here, as on the cloud server: the app reads files itself.
    server = await startTestServer(fakeFetch, { ffmpeg: null, keys: { tmdbApiKey: "test-key", torboxApiKey: "tb-test" } });
    token = ((await (await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "aa", password: "password1" } })).json()) as { token: string }).token;
  }, 60_000);

  afterAll(() => {
    server.services.shutdown();
    cdn.stop(true);
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

  test("play with nothing in the library adds the cached release; the app reads it and plays it from TorBox", async () => {
    const caps = { containers: ["mp4", "mov", "m4v"], videoCodecs: ["h264", "hevc"], audioCodecs: ["aac", "ac3", "eac3"], maxHeight: 2160, hdr: ["hdr10", "dv"], dvProfiles: [5, 8], deviceRemux: true };
    const ask = () => server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, caps } });
    // The server can't read the file: it hands the app the link to read it from.
    const first = await ask();
    expect(first.status).toBe(428);
    const { needsProbe } = (await first.json()) as { needsProbe: { fileId: number; url: string } };
    expect(needsProbe.url).toBe(`http://127.0.0.1:${cdn.port}/file.mkv`);
    // What the app read.
    const info = {
      container: "mkv",
      durationMs: 596_000,
      video: { index: 0, codec: "h264", width: 1920, height: 1080, fps: 24, bitDepth: 8, hdr: null },
      audio: [{ index: 1, codec: "dts", channels: 6, language: "eng", isDefault: true }],
      subtitles: [{ index: 2, codec: "subrip", language: "eng", isDefault: false, isForced: false, isText: true }],
      chapters: [],
    };
    expect((await server.request(`/api/files/${needsProbe.fileId}/probe`, { method: "POST", token, json: { ...info, container: 7 } })).status).toBe(400);
    expect((await server.request(`/api/files/${needsProbe.fileId}/probe`, { method: "POST", token, json: info })).status).toBe(200);
    const res = await ask();
    expect(res.status).toBe(200);
    const play = (await res.json()) as { mode: string; url: string; sessionId: string; candidate: { provider: string }; remux: { audio: string }; subtitleTracks: { embedded?: boolean }[] };
    expect(play.mode).toBe("device");
    expect(play.url).toBe(needsProbe.url); // straight from TorBox
    expect(play.remux.audio).toBe("lossless");
    expect(play.subtitleTracks[0]!.embedded).toBe(true);
    expect(play.candidate.provider).toBe("torbox");
    // Its session is in the database: any server can refresh the link.
    const link = await server.request(`/api/play/${play.sessionId}/link`, { method: "POST", token });
    expect(((await link.json()) as { url: string }).url).toBe(needsProbe.url);
    await server.services.sessions.stop(play.sessionId);
    // The release is now part of the library and no longer "discovered".
    const { items } = (await (await server.request("/api/sources?mediaType=movie&tmdbId=10378&discover=1", { token })).json()) as { items: { id: string }[] };
    expect(items[0]!.id).toMatch(/^file:/);
    expect(items.some((i) => i.id === `hash:${CACHED}`)).toBe(false);
  }, 60_000);

  test("refuses hashes discovery didn't offer", async () => {
    for (const candidateId of [`hash:${"d".repeat(40)}`, "hash:not-a-hash", "hash:abc&dn=x"]) {
      const res = await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId } });
      expect(res.status).toBe(404);
    }
  });

  test("a library torrent can't be replayed as a different title", async () => {
    const before = (await (await server.household()).library.byHash(CACHED)).map((f) => [f.id, f.mediaType, f.titleId]);
    expect(before.length).toBeGreaterThan(0);
    const res = await server.request("/api/play", { method: "POST", token, json: { mediaType: "episode", tmdbId: 9001, season: 1, episode: 1, candidateId: `hash:${CACHED}` } });
    expect(res.status).toBe(404);
    expect((await (await server.household()).library.byHash(CACHED)).map((f) => [f.id, f.mediaType, f.titleId])).toEqual(before);
  });

  test("an uncached release reports download progress", async () => {
    const res = await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: `hash:${UNCACHED}` } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "downloading", progress: 0.1 });
    // Asking again doesn't add a second copy.
    await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, candidateId: `hash:${UNCACHED}` } });
    expect(torrents.filter((t) => t.hash === UNCACHED)).toHaveLength(1);
  }, 60_000);
});

describe("releases for AniList titles", () => {
  test("Torrentio by the entry's Kitsu id and AniList episode, and by IMDb id in TMDB's numbering", async () => {
    const { Discovery } = await import("../src/sources/discovery");
    const { AnimeIds, fileAnimeIdStore } = await import("../src/catalog/anime/ids");
    const { settingsSchema } = await import("../src/settings");
    const ids = new AnimeIds(fileAnimeIdStore("/nonexistent"));
    ids.index([
      { type: "TV", anilist_id: 154587, kitsu_id: 46474, themoviedb_id: { tv: 209867 }, season: { tvdb: 1, tmdb: 1 } },
      { type: "TV", anilist_id: 182255, kitsu_id: 49240, themoviedb_id: { tv: 209867 }, season: { tvdb: 2, tmdb: 1 }, episode_offset: { tmdb: 28 } },
      { type: "TV", anilist_id: 777 },
    ]);
    ids.ready = async () => {};
    const asked: string[] = [];
    const fetchImpl = (async (input: string) => {
      const path = new URL(input).pathname;
      asked.push(path);
      const streams = path.includes("kitsu")
        ? [{ title: "[SubsPlease] Sousou no Frieren S2 - 02 (1080p)\n👤 40 💾 1.4 GB", infoHash: "a".repeat(40) }]
        : [
            { title: "Frieren.S01E30.1080p.WEB\n👤 10 💾 1.4 GB", infoHash: "b".repeat(40) },
            { title: "Frieren.S01E29.1080p.WEB\n👤 10 💾 1.4 GB", infoHash: "c".repeat(40) },
          ];
      return Response.json({ streams });
    }) as unknown as typeof fetch;
    const tmdb = { show: async () => ({ id: 209867, external_ids: { imdb_id: "tt22248376" }, seasons: [{ season_number: 1, episode_count: 38 }] }) } as never;
    const settings = settingsSchema.parse({ torrentioUrl: "https://torrentio.example" });
    const discovery = new Discovery(tmdb, {} as never, () => settings as never, () => null, fetchImpl, () => {}, ids);

    const releases = await discovery.releases({ source: "anilist", mediaType: "episode", titleId: 182255, season: 1, episode: 2 });
    expect(asked.sort()).toEqual(["/stream/series/kitsu:49240:2.json", "/stream/series/tt22248376:1:30.json"]);
    // Kitsu's pick is the episode; IMDb's are checked against TMDB S1E30.
    expect(releases.map((r) => r.hash[0]).sort()).toEqual(["a", "b"]);
    // Not on the id list: nothing to ask for.
    expect(await discovery.releases({ source: "anilist", mediaType: "episode", titleId: 999, season: 1, episode: 1 })).toEqual([]);
  });
});
