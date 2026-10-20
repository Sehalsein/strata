import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { makeFixtures, startTestServer, type TestServer } from "./helpers";

let server: TestServer;
let token: string;
let media: string;
const json = async (res: Response) => (await res.json()) as any;

beforeAll(async () => {
  media = await makeFixtures();
  server = await startTestServer();
}, 60_000);

afterAll(() => server.services.shutdown());

describe("setup and auth", () => {
  test("info reports setup required", async () => {
    const info = await json(await server.request("/api/info"));
    expect(info).toMatchObject({ name: "strata", setupRequired: true, apiVersion: 1 });
  });

  test("protected routes need a token", async () => {
    expect((await server.request("/api/home")).status).toBe(401);
    expect((await server.request("/api/admin/status")).status).toBe(401);
  });

  test("first admin is created once", async () => {
    const res = await server.request("/api/setup/admin", { method: "POST", json: { username: "sehal", password: "correct-horse" } });
    expect(res.status).toBe(200);
    token = (await json(res)).token;
    const again = await server.request("/api/setup/admin", { method: "POST", json: { username: "x", password: "another-pass" } });
    expect(again.status).toBe(409);
  });

  test("login, and the single profile is auto-selected", async () => {
    expect((await server.request("/api/auth/login", { method: "POST", json: { username: "sehal", password: "nope" } })).status).toBe(401);
    const res = await server.request("/api/auth/login", { method: "POST", json: { username: "sehal", password: "correct-horse" } });
    token = (await json(res)).token;
    const me = await json(await server.request("/api/me", { token }));
    expect(me.user).toMatchObject({ username: "sehal", isAdmin: true });
    expect(me.profile.name).toBe("sehal");
  });

  test("a TV signs in by code once a signed-in phone approves it", async () => {
    const start = await json(await server.request("/api/auth/device", { method: "POST", json: { deviceName: "Living Room Apple TV" } }));
    expect(start.code).toMatch(/^[A-Z2-9]{8}$/);
    const poll = () => server.request("/api/auth/device/poll", { method: "POST", json: { pollToken: start.pollToken } }).then(json);
    expect(await poll()).toEqual({ status: "pending" });

    // Looking up and approving need a signed-in phone; lower-case and dashes are fine.
    const typed = `${start.code.slice(0, 4)}-${start.code.slice(4)}`.toLowerCase();
    expect((await server.request(`/api/auth/device/${typed}`)).status).toBe(401);
    expect(await json(await server.request(`/api/auth/device/${typed}`, { token }))).toMatchObject({ deviceName: "Living Room Apple TV" });
    expect((await server.request(`/api/auth/device/${typed}/approve`, { method: "POST", token })).status).toBe(200);

    const approved = await poll();
    expect(approved.status).toBe("approved");
    expect((await server.request("/api/me", { token: approved.token })).status).toBe(200);

    // Single use: the token is handed over once and the code is gone.
    expect(await poll()).toEqual({ status: "expired" });
    expect((await server.request(`/api/auth/device/${start.code}/approve`, { method: "POST", token })).status).toBe(404);
  });

  test("PIN-protected profile", async () => {
    const created = await json(await server.request("/api/profiles", { method: "POST", token, json: { name: "Kids", pin: "1234" } }));
    expect(created.hasPin).toBe(true);
    const wrong = await server.request(`/api/profiles/${created.id}/select`, { method: "POST", token, json: { pin: "0000" } });
    expect(wrong.status).toBe(403);
    const right = await server.request(`/api/profiles/${created.id}/select`, { method: "POST", token, json: { pin: "1234" } });
    expect(right.status).toBe(200);
    // Back to the main profile for the rest of the suite.
    await server.request(`/api/profiles/1/select`, { method: "POST", token, json: {} });
  });

  test("home-network devices join without a password, as viewers", async () => {
    const info = async (init: { ip?: string; headers?: Record<string, string> }) => (await json(await server.request("/api/info", init))).localJoin;
    expect(await info({ ip: "192.168.2.40" })).toBe(true);
    expect(await info({ ip: "::ffff:10.0.0.7" })).toBe(true);
    expect(await info({ ip: "203.0.113.9" })).toBe(false);
    expect(await info({})).toBe(false);
    // Behind a proxy every client looks local, so proxied requests never qualify.
    expect(await info({ ip: "127.0.0.1", headers: { "X-Forwarded-For": "203.0.113.9" } })).toBe(false);
    // A web page (it sends Origin) or a DNS-rebound domain in Host can't join for someone.
    expect(await info({ ip: "192.168.2.40", headers: { Origin: "http://evil.example" } })).toBe(false);
    expect(await info({ ip: "192.168.2.40", headers: { Host: "rebind.evil.example:8420" } })).toBe(false);
    expect(await info({ ip: "192.168.2.40", headers: { Host: "strata.local:8420" } })).toBe(true);

    expect((await server.request("/api/auth/join", { method: "POST", ip: "203.0.113.9", json: {} })).status).toBe(403);
    const joined = await server.request("/api/auth/join", { method: "POST", ip: "192.168.2.40", json: { deviceName: "Living Room" } });
    expect(joined.status).toBe(200);
    const viewer = (await json(joined)).token;

    // Two profiles now, one with a PIN: the device picks, and the PIN still applies.
    expect((await json(await server.request("/api/me", { token: viewer }))).profile).toBeNull();
    const kids = (await json(await server.request("/api/profiles", { token: viewer }))).find((p: any) => p.name === "Kids");
    expect((await server.request(`/api/profiles/${kids.id}/select`, { method: "POST", token: viewer, json: {} })).status).toBe(403);
    expect((await server.request(`/api/profiles/${kids.id}/select`, { method: "POST", token: viewer, json: { pin: "1234" } })).status).toBe(200);

    // Watching yes, administering no.
    expect((await server.request("/api/home", { token: viewer })).status).toBe(200);
    expect((await server.request("/api/admin/settings", { token: viewer })).status).toBe(403);
    expect((await json(await server.request("/api/me", { token: viewer }))).user.isAdmin).toBe(false);

    // Rate limited per address.
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await server.request("/api/auth/join", { method: "POST", ip: "192.168.2.77", json: {} })).status;
    expect(last).toBe(429);

    // The admin can switch it off.
    await server.request("/api/admin/settings", { method: "PATCH", token, json: { localJoin: false } });
    expect((await server.request("/api/auth/join", { method: "POST", ip: "192.168.2.40", json: {} })).status).toBe(403);
    await server.request("/api/admin/settings", { method: "PATCH", token, json: { localJoin: true } });
  });
});

describe("library", () => {
  test("movie detail lists trailers and extras, official trailers first", async () => {
    const movie = await json(await server.request("/api/titles/movie/10378", { token }));
    expect(movie.trailer.key).toBe("official");
    expect(movie.videos.map((v: any) => v.key)).toEqual(["official", "fan", "clip1"]);
    expect(movie.videos[0]).toMatchObject({ type: "Trailer", url: "https://www.youtube.com/watch?v=official", thumbnailUrl: "https://i.ytimg.com/vi/official/hqdefault.jpg" });
  });

  test("settings and folder scan", async () => {
    const res = await server.request("/api/admin/settings", {
      method: "PATCH",
      token,
      json: { mediaFolders: [{ path: join(media, "Movies"), kind: "movies" }, { path: join(media, "Shows"), kind: "shows" }] },
    });
    expect(res.status).toBe(200);
    await server.services.jobs.run("scanLocal");
    const files = (await json(await server.request("/api/admin/files", { token }))).items;
    expect(files).toHaveLength(3);
    expect(files.every((f: any) => f.matchStatus === "matched")).toBe(true);
  });

  test("home shows library shelves with availability", async () => {
    const { shelves } = await json(await server.request("/api/home", { token }));
    const ids = shelves.map((s: any) => s.id);
    expect(ids).toContain("libraryMovies");
    expect(ids).toContain("libraryShows");
    const trending = shelves.find((s: any) => s.id === "trendingMovies");
    expect(trending.items[0].available).toEqual(["local"]);
  });

  test("genres: the list, and rails for one genre including library titles", async () => {
    expect((await json(await server.request("/api/genres/movie", { token }))).items).toContainEqual({ id: 35, name: "Comedy" });
    // Library titles get their genres from the backfill (older rows) or at match time.
    await server.services.jobs.run("backfillGenres");
    const { shelves } = await json(await server.request("/api/browse/movie/genre/16", { token }));
    expect(shelves.map((s: any) => s.id)).toEqual(["library", "popular", "topRated", "new"]);
    expect(shelves[0].items[0]).toMatchObject({ tmdbId: 10378, available: ["local"] });
    const comedy = await json(await server.request("/api/browse/movie/genre/35", { token }));
    expect(comedy.shelves).toEqual([]);
  });

  test("person page lists their work, deduplicated, by department", async () => {
    const person = await json(await server.request("/api/person/77", { token }));
    expect(person).toMatchObject({ name: "Sacha Goedegebure", knownFor: "Directing", biography: "Dutch animator." });
    // A director's page lists directing/writing/creating, not other crew jobs, each title once.
    expect(person.movies.map((m: any) => m.tmdbId)).toEqual([10378]);
    expect(person.movies[0].role).toBe("Director");
    expect(person.shows.map((s: any) => s.tmdbId)).toEqual([9001]);
  });

  test("season detail marks available episodes", async () => {
    const season = await json(await server.request("/api/titles/show/9001/seasons/1", { token }));
    expect(season.episodes.map((e: any) => e.available)).toEqual([["local"], ["local"]]);
  });
});

describe("playback", () => {
  test("mp4 + aac direct plays with byte ranges", async () => {
    const play = await json(await server.request("/api/play", { method: "POST", token, json: { mediaType: "episode", tmdbId: 9001, season: 1, episode: 1 } }));
    expect(play.mode).toBe("direct");
    expect(play.nextEpisode).toMatchObject({ season: 1, episode: 2, name: "Second", available: true });
    // The next episode's file gets probed in the background.
    const nextFile = (await json(await server.request("/api/sources?mediaType=episode&tmdbId=9001&season=1&episode=2", { token }))).items[0];
    for (let i = 0; i < 50 && !server.services.library.get(nextFile.fileId)?.probeJson; i++) await Bun.sleep(100);
    expect(server.services.library.get(nextFile.fileId)?.probeJson).toBeTruthy();
    const res = await server.request(play.url, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 0-99\//);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  test("mkv remuxes to HLS from the resume point", async () => {
    await server.request("/api/progress", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, positionMs: 90_000, durationMs: 3_600_000 } });
    const play = await json(await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378 } }));
    expect(play.mode).toBe("remux");
    // Resume is clamped to 10 s before the (30 s) file's end.
    expect(play.startOffsetMs).toBe(20_000);
    const playlist = await server.request(play.url);
    expect(playlist.status).toBe(200);
    const text = await playlist.text();
    expect(text).toContain("#EXT-X-MAP:URI=\"init.mp4\"");
    const segment = await server.request(play.url.replace("stream.m3u8", "seg00000.m4s"));
    expect(segment.status).toBe(200);
    expect((await segment.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await server.request(`/api/play/${play.sessionId}`, { method: "DELETE", token })).status).toBe(200);
  }, 30_000);

  test("embedded and sidecar subtitles are served as WebVTT", async () => {
    const play = await json(await server.request("/api/play", { method: "POST", token, json: { mediaType: "movie", tmdbId: 10378, startMs: 0 } }));
    const tracks = play.subtitleTracks;
    expect(tracks.map((t: any) => [t.external, t.language, t.forced])).toEqual([
      [false, "eng", false],
      [true, "en", true],
    ]);
    const embedded = await server.request(tracks[0].url);
    expect(embedded.status).toBe(200);
    expect(embedded.headers.get("content-type")).toContain("text/vtt");
    const text = await embedded.text();
    expect(text).toStartWith("WEBVTT");
    expect(text).toContain("Hello from Strata");
    expect(await (await server.request(tracks[1].url)).text()).toContain("Forced sidecar");
    server.services.sessions.stop(play.sessionId);
  }, 30_000);

  test("DTS audio is transcoded", async () => {
    const play = await json(await server.request("/api/play", { method: "POST", token, json: { mediaType: "episode", tmdbId: 9001, season: 1, episode: 2 } }));
    expect(play.mode).toBe("remux");
    expect(play.reasons.join(" ")).toContain("audio dts");
    const res = await server.request(play.url.replace("stream.m3u8", "init.mp4"));
    expect(res.status).toBe(200);
    server.services.sessions.stop(play.sessionId);
  }, 30_000);

  test("progress feeds continue watching and next up", async () => {
    await server.request("/api/progress", { method: "POST", token, json: { mediaType: "episode", tmdbId: 9001, season: 1, episode: 1, positionMs: 29_000, durationMs: 30_000 } });
    const { shelves } = await json(await server.request("/api/home", { token }));
    const cont = shelves.find((s: any) => s.id === "continue");
    expect(cont.items[0]).toMatchObject({ type: "movie", tmdbId: 10378, positionMs: 90_000 });
    const next = shelves.find((s: any) => s.id === "nextUp");
    expect(next.items[0]).toMatchObject({ type: "show", tmdbId: 9001, episode: { season: 1, episode: 2 } });
  });
});
