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
  const signIn = async (username: string, password: string) => {
    const res = await server.request("/api/auth/sign-in/username", { method: "POST", json: { username, password } });
    return { status: res.status, token: res.headers.get("set-auth-token") };
  };

  test("info reports setup required", async () => {
    const info = await json(await server.request("/api/info"));
    expect(info).toMatchObject({ name: "strata", setupRequired: true, apiVersion: 1, mode: "home" });
  });

  test("protected routes need a token", async () => {
    expect((await server.request("/api/home")).status).toBe(401);
    expect((await server.request("/api/admin/status")).status).toBe(401);
  });

  test("first admin is created once, with their household", async () => {
    const res = await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "sehal", password: "correct-horse" } });
    expect(res.status).toBe(200);
    token = (await json(res)).token;
    const again = await server.request("/api/setup/admin", { method: "POST", ip: "127.0.0.1", json: { username: "other", password: "another-pass" } });
    expect(again.status).toBe(409);
  });

  test("sign in by username; the account's only household opens by itself", async () => {
    expect((await signIn("sehal", "nope")).status).toBe(401);
    const ok = await signIn("sehal", "correct-horse");
    expect(ok.status).toBe(200);
    token = ok.token!;
    const me = await json(await server.request("/api/me", { token }));
    expect(me.user).toMatchObject({ username: "sehal", isServerAdmin: true });
    expect(me.household).toMatchObject({ name: "sehal's home", role: "owner" });
  });

  test("people join a household by invitation only", async () => {
    // Nobody signs up without an invitation.
    const signUp = (email: string, username: string, invitationId?: string) =>
      server.request("/api/auth/sign-up/email", { method: "POST", json: { email, password: "bobs-password", name: username, username, invitationId } });
    expect((await signUp("bob@example.com", "bob")).status).toBe(403);
    const invited = await json(await server.request("/api/auth/organization/invite-member", { method: "POST", token, json: { email: "bob@example.com", role: "member" } }));
    expect(invited.id).toBeTruthy();
    // Knowing the email isn't enough: the invitation's id (from its link) is.
    expect((await signUp("bob@example.com", "bob")).status).toBe(403);
    expect((await signUp("bob@example.com", "bob", invited.id)).status).toBe(200);
    const bob = (await signIn("bob", "bobs-password")).token!;
    expect((await server.request("/api/auth/organization/accept-invitation", { method: "POST", token: bob, json: { invitationId: invited.id } })).status).toBe(200);
    const me = await json(await server.request("/api/me", { token: bob }));
    expect(me.household).toMatchObject({ role: "member" });
    // Members watch; they don't run the household.
    expect((await server.request("/api/home", { token: bob })).status).toBe(200);
    expect((await server.request("/api/admin/settings", { token: bob })).status).toBe(403);
  });

  test("households don't see each other's library", async () => {
    const mine = await server.services.households.get((await json(await server.request("/api/me", { token }))).household.id);
    await mine.library.upsert({ provider: "local", ref: "/m/Only.Mine.2020.mkv", name: "Only.Mine.2020.mkv", size: 1, parsed: { title: "Only Mine", kind: "movie" } as never });
    // The server admin opens a second household and invites its owner.
    const other = await json(await server.request("/api/auth/organization/create", { method: "POST", token, json: { name: "The Neighbours", slug: "neighbours" } }));
    await server.request("/api/auth/organization/set-active", { method: "POST", token, json: { organizationId: other.id } });
    const invite = await json(await server.request("/api/auth/organization/invite-member", { method: "POST", token, json: { email: "carol@example.com", role: "owner", organizationId: other.id } }));
    await server.request("/api/auth/sign-up/email", { method: "POST", json: { email: "carol@example.com", password: "carols-password", name: "carol", username: "carol", invitationId: invite.id } });
    const carol = (await signIn("carol", "carols-password")).token!;
    await server.request("/api/auth/organization/accept-invitation", { method: "POST", token: carol, json: { invitationId: invite.id } });
    await server.request("/api/auth/organization/set-active", { method: "POST", token: carol, json: { organizationId: other.id } });
    const files = async (t: string) => (await json(await server.request("/api/admin/files", { token: t }))).items.map((f: any) => f.name);
    expect(await files(carol)).toEqual([]);
    // Back to the first household for the rest of the suite.
    await server.request("/api/auth/organization/set-active", { method: "POST", token, json: { organizationId: mine.organizationId } });
    expect(await files(token)).toContain("Only.Mine.2020.mkv");
    await mine.library.markMissing("local", []);
  });

  test("a TV signs in by code once a signed-in phone approves it, and can only watch", async () => {
    const code = await json(await server.request("/api/auth/device/code", { method: "POST", json: { client_id: "strata-apple-tv" } }));
    expect(code.user_code).toBeTruthy();
    const poll = () => server.request("/api/auth/device/token", { method: "POST", json: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code.device_code, client_id: "strata-apple-tv" } });
    expect((await json(await poll())).error).toBe("authorization_pending");
    // Only known apps may ask for a code.
    expect((await server.request("/api/auth/device/code", { method: "POST", json: { client_id: "someone-else" } })).status).toBe(400);
    // The phone opens the code (signed in), then approves it.
    expect((await server.request(`/api/auth/device?user_code=${code.user_code}`, { token })).status).toBe(200);
    expect((await server.request("/api/auth/device/approve", { method: "POST", token, json: { userCode: code.user_code } })).status).toBe(200);
    await Bun.sleep(2_100); // the poll interval
    const tv = (await json(await poll())).access_token;
    expect(tv).toBeTruthy();
    const me = await json(await server.request("/api/me", { token: tv }));
    expect(me).toMatchObject({ viewerOnly: true, household: { role: "owner" } });
    expect((await server.request("/api/home", { token: tv })).status).toBe(200);
    expect((await server.request("/api/admin/settings", { token: tv })).status).toBe(403);
  });

  test("a kids' account hides and refuses titles above its limit", async () => {
    const { members } = await json(await server.request("/api/auth/organization/get-full-organization", { token }));
    const bobMember = members.find((m: any) => m.user.name === "bob");
    expect((await json(await server.request(`/api/household/members/${bobMember.id}`, { method: "PATCH", token, json: { isKids: true } })))).toMatchObject({ isKids: true, contentLimit: "kids" });
    const bob = (await signIn("bob", "bobs-password")).token!;
    const titles = async (t: string) => (await json(await server.request("/api/search?q=night", { token: t }))).items.map((i: any) => i.tmdbId);
    expect(await titles(bob)).toEqual([10378]); // R-rated horror is gone; unrated family animation stays
    expect((await server.request("/api/titles/movie/666", { token: bob })).status).toBe(403);
    expect((await server.request("/api/play", { method: "POST", token: bob, json: { mediaType: "movie", tmdbId: 666 } })).status).toBe(403);
    expect((await server.request("/api/titles/movie/10378", { token: bob })).status).toBe(200);
    // Other accounts are unaffected.
    expect(await titles(token)).toEqual([666, 10378]);
  });

  test("launcher proof: only with the launch secret, only from loopback", async () => {
    const challenge = "ab".repeat(16);
    const ask = (ip?: string, headers: Record<string, string> = {}) =>
      server.request("/api/launcher/proof", { ip, headers: { "X-Strata-Challenge": challenge, ...headers } });
    // The test server wasn't started by Strata.app, so there's no secret: always 404.
    expect((await ask("127.0.0.1")).status).toBe(404);
    expect((await ask("192.168.2.40")).status).toBe(404);
  });

  test("home-network devices join without a password, as a member they pick, to watch", async () => {
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

    expect((await server.request("/api/join", { method: "POST", ip: "203.0.113.9", json: {} })).status).toBe(403);
    const choices = await json(await server.request("/api/join", { method: "POST", ip: "192.168.2.40", json: {} }));
    expect(choices.members.map((m: any) => m.name)).toEqual(["sehal", "bob"]);
    const bobId = choices.members.find((m: any) => m.name === "bob").id;
    const joined = await json(await server.request("/api/join", { method: "POST", ip: "192.168.2.40", json: { userId: bobId } }));
    const me = await json(await server.request("/api/me", { token: joined.token }));
    expect(me).toMatchObject({ viewerOnly: true, user: { username: "bob" } });
    expect((await server.request("/api/home", { token: joined.token })).status).toBe(200);
    // Someone outside the household can't be picked.
    expect((await server.request("/api/join", { method: "POST", ip: "192.168.2.40", json: { userId: "not-a-member" } })).status).toBe(404);
  });

  test("the household's admins see every device, whose it is, and can sign it out", async () => {
    const choices = await json(await server.request("/api/join", { method: "POST", ip: "192.168.2.41", json: {} }));
    const bobId = choices.members.find((m: any) => m.name === "bob").id;
    const joined = await json(await server.request("/api/join", { method: "POST", ip: "192.168.2.41", json: { userId: bobId }, headers: { "User-Agent": "Strata/1.0 (AppleTV; tvOS 26)" } }));
    const devices = (await json(await server.request("/api/admin/devices", { token }))).items;
    const bobs = devices.find((d: any) => d.userId === bobId && d.userAgent?.includes("AppleTV"));
    expect(bobs).toMatchObject({ userName: "bob", viewerOnly: true, isCurrent: false });
    expect(devices.some((d: any) => d.isCurrent && d.userName === "sehal")).toBe(true);
    expect(devices.every((d: any) => d.token === undefined)).toBe(true);
    // Members don't see the household's devices.
    expect((await server.request("/api/admin/devices", { token: joined.token })).status).toBe(403);
    expect((await server.request(`/api/admin/devices/${bobs.id}`, { method: "DELETE", token })).status).toBe(200);
    expect((await server.request("/api/me", { token: joined.token })).status).toBe(401);
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

  test("home: catalog rails with library availability (Recently Added is the catalog's, not the library's)", async () => {
    const { shelves } = await json(await server.request("/api/home", { token }));
    const ids = shelves.map((s: any) => s.id);
    expect(ids).not.toContain("libraryMovies");
    expect(ids).not.toContain("libraryShows");
    const trending = shelves.find((s: any) => s.id === "trendingMovies");
    expect(trending.items[0].available).toEqual(["local"]);
  });

  test("genres: the list, and rails for one genre (trending, then new)", async () => {
    const genres = (await json(await server.request("/api/genres/movie", { token }))).items;
    expect(genres.some((g: any) => g.id === -1)).toBe(false); // anime has its own tab now
    expect(genres).toContainEqual({ id: 35, name: "Comedy" });
    const anime = await json(await server.request("/api/browse/movie/genre/-1", { token }));
    expect(anime.shelves[0].items[0]).toMatchObject({ tmdbId: 129, title: "Spirited Away" });
    const { shelves } = await json(await server.request("/api/browse/movie/genre/16", { token }));
    expect(shelves.map((s: any) => s.id)).toEqual(["trending", "new", "popular", "topRated"]);
    expect(shelves[1].items[0]).toMatchObject({ tmdbId: 10378, available: ["local"] });
    const comedy = await json(await server.request("/api/browse/movie/genre/35", { token }));
    expect(comedy.shelves).toEqual([]);
  });

  test("anime tab: its categories, and unknown ones are refused", async () => {
    const { items } = await json(await server.request("/api/anime/categories", { token }));
    expect(items).toContainEqual({ id: "isekai", name: "Isekai" });
    expect((await server.request("/api/anime?category=../x", { token })).status).toBe(400);
    expect((await server.request("/api/anime", { token })).status).toBe(200);
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
    // Sources carry the labels the apps show as they are.
    expect(nextFile).toMatchObject({ availability: "ready", originLabel: "Library", label: expect.any(String) });
    for (let i = 0; i < 50 && !(await (await server.household()).library.get(nextFile.fileId))?.probeJson; i++) await Bun.sleep(100);
    expect((await (await server.household()).library.get(nextFile.fileId))?.probeJson).toBeTruthy();
    const res = await server.request(play.url, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 0-99\//);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  test("Continue Watching: removing a title hides it until it's watched again", async () => {
    const watch = (positionMs: number) => server.request("/api/progress", { method: "POST", token, json: { mediaType: "movie", tmdbId: 666, positionMs, durationMs: 3_600_000 } });
    const continuing = async () => ((await json(await server.request("/api/home", { token }))).shelves.find((s: any) => s.id === "continue")?.items ?? []).map((c: any) => c.tmdbId);
    await watch(600_000);
    expect(await continuing()).toContain(666);
    expect((await server.request("/api/continue/movie/666", { method: "DELETE", token })).status).toBe(200);
    expect(await continuing()).not.toContain(666);
    await Bun.sleep(5);
    await watch(700_000); // watched again: back, with its progress
    expect(await continuing()).toContain(666);
    expect((await server.request("/api/continue/album/1", { method: "DELETE", token })).status).toBe(400);
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
