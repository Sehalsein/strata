// A demo Strata server for App Store screenshots, App Review and trying the apps: a
// library of public-domain films and episodes (see fetch-media.ts), real TMDB details for
// them, and every catalog list (trending, new, popular, recommendations…) limited to that
// library, so no current, copyrighted titles appear anywhere.
//
//   TMDB_API_KEY=… bun scripts/demo/serve.ts [--media ~/StrataDemo/media] [--port 8460] [--public]
//
// Local (default): sign in as "Alex" / "demo-password", an admin.
// --public (the hosted demo): sign in as "demo" / "strata-demo", a viewer-only account;
// the admin's password is random and never shown, admin routes are refused for everyone,
// and nothing reaches out (no TorBox, release search, updates or home-network join).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/api/app";
import { profiles, sessions, users } from "../../src/db/schema";
import { createServices, type Services } from "../../src/services";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const media = arg("media", join(homedir(), "StrataDemo", "media"));
const port = Number(arg("port", "8460"));
const publicDemo = process.argv.includes("--public");
if (!process.env.TMDB_API_KEY) throw new Error("Set TMDB_API_KEY: the demo shows real TMDB details for its public-domain titles.");
process.env.STRATA_NO_JOBS = "1";
process.env.STRATA_DOCKER = "1"; // no self-update
if (publicDemo) process.env.STRATA_DEMO = "1"; // admin routes refused (api/context.ts)

let services: Services | undefined;

/** The library's titles as TMDB list items (from cached details). */
async function libraryItems(type: "movie" | "tv"): Promise<unknown[]> {
  if (!services) return [];
  const rows = services.library.recentlyAdded(type === "movie" ? "movie" : "show", 50);
  const details = await Promise.all(rows.map((r) => (type === "movie" ? services!.tmdb.movie(r.tmdbId) : services!.tmdb.show(r.tmdbId)).catch(() => null)));
  return details
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({ ...d, media_type: type, genre_ids: d.genres.map((g) => g.id) }));
}

const page = (results: unknown[]) => Response.json({ page: 1, results, total_pages: 1, total_results: results.length });
const LISTS = /^\/3\/(trending\/(movie|tv)\/week|discover\/(movie|tv)|(movie|tv)\/(popular|top_rated|now_playing|on_the_air))$/;

/** TMDB with every list narrowed to the demo library; details pass through. Nothing else goes out. */
const demoFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.themoviedb.org") {
    const list = LISTS.exec(url.pathname);
    if (list) {
      const type = url.pathname.includes("/tv") ? "tv" : "movie";
      // Japanese animation (the anime rails) has no public-domain stand-in here.
      if (url.searchParams.get("with_original_language") === "ja") return page([]);
      let items = await libraryItems(type);
      const genre = url.searchParams.get("with_genres");
      if (genre) items = items.filter((i) => (i as { genre_ids: number[] }).genre_ids.includes(Number(genre)));
      if (url.searchParams.get("page") && url.searchParams.get("page") !== "1") items = [];
      return page(items);
    }
    if (url.pathname === "/3/search/multi") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      const all = [...(await libraryItems("movie")), ...(await libraryItems("tv"))];
      return page(all.filter((i) => JSON.stringify(i).toLowerCase().includes(q)));
    }
    const res = await fetch(input, init);
    // Title pages: "More Like This" only from the library too.
    if (/^\/3\/(movie|tv)\/\d+$/.test(url.pathname) && res.ok) {
      const body = (await res.json()) as { recommendations?: { results: { id: number }[] } };
      if (body.recommendations && services) {
        const type = url.pathname.includes("/tv/") ? "show" : "movie";
        const ids = new Set(services.library.recentlyAdded(type, 100).map((r) => r.tmdbId));
        body.recommendations.results = body.recommendations.results.filter((r) => ids.has(r.id));
      }
      return Response.json(body);
    }
    return res;
  }
  // Anime rankings, AniList, the anime id list, release search, TorBox: none in the demo.
  return new Response("not in the demo", { status: 404 });
}) as typeof fetch;

const dataDir = mkdtempSync(join(tmpdir(), "strata-demo-"));
services = await createServices({ dataDir, port, host: "0.0.0.0" }, { fetch: demoFetch });

// Accounts and profiles, straight through the services (the demo refuses admin routes).
const admin = publicDemo ? { username: `admin-${randomBytes(4).toString("hex")}`, password: randomBytes(24).toString("base64url") } : { username: "Alex", password: "demo-password" };
await services.auth.createFirstAdmin(admin.username, admin.password);
if (publicDemo) await services.auth.createUser("demo", "strata-demo", false);
const [alex, , kids] = ["Alex", "Sam", "Kids"].map((name) =>
  services!.db.insert(profiles).values({ name, isKids: name === "Kids", contentLimit: name === "Kids" ? "kids" : "none" }).returning().get(),
);
void kids;
services.settings.update({
  serverName: publicDemo ? "Strata Demo" : "Strata",
  mediaFolders: [{ path: join(media, "Movies"), kind: "movies" }, { path: join(media, "Shows"), kind: "shows" }],
  // Nothing that reaches out or costs: no release search, no join without a password.
  discoveryEnabled: false,
  torrentioUrl: "",
  useTorboxSearch: false,
  localJoin: false,
  bonjourEnabled: false,
  hardwareAcceleration: false,
  maxTranscodes: 1,
});
await services.jobs.run("scanLocal");
await services.library.matchPending();

// Something to continue, something next up, and a few saved for later (Alex's profile).
const movies = services.library.recentlyAdded("movie", 20).map((m) => m.tmdbId);
const shows = services.library.recentlyAdded("show", 20).map((s) => s.tmdbId);
const minutes = (n: number) => n * 60_000;
// Positions inside the clips, which are 3 minutes long (fetch-media.ts), so resuming plays.
if (movies[0]) services.progress.record(alex!.id, { mediaType: "movie", tmdbId: movies[0] }, minutes(1.3), minutes(3));
if (movies[2]) services.progress.record(alex!.id, { mediaType: "movie", tmdbId: movies[2] }, minutes(0.6), minutes(3));
// An episode the library actually has (the demo carries a few per show, not whole seasons).
const episode = shows[0] ? services.library.filesFor("episode", shows[0]).sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!))[0] : undefined;
if (episode) services.progress.record(alex!.id, { mediaType: "episode", tmdbId: shows[0]!, season: episode.season!, episode: episode.episode! }, minutes(1), minutes(3));
for (const id of movies.slice(3, 6)) services.progress.setWatchlist(alex!.id, "movie", id, true);
if (shows[1]) services.progress.setWatchlist(alex!.id, "show", shows[1], true);

const app = createApp(services);
const demoUser = publicDemo ? services.db.select({ id: users.id }).from(users).where(eq(users.username, "demo")).get() : undefined;
const restoreKey = process.env.DEMO_RESTORE_KEY ?? "";

/**
 * The hosted demo starts from scratch whenever its container wakes, which would sign
 * everyone out. Its Worker remembers sign-ins (by token hash) and puts them back here.
 * Only the Worker can reach this: it never forwards paths outside /api, and the key is
 * a secret the two share.
 */
async function restoreSession(req: Request): Promise<Response> {
  const key = Buffer.from(req.headers.get("X-Demo-Key") ?? "");
  if (!demoUser || restoreKey.length < 32 || key.length !== restoreKey.length || !timingSafeEqual(key, Buffer.from(restoreKey))) {
    return new Response("not found", { status: 404 });
  }
  const { tokenHash, profileId } = (await req.json()) as { tokenHash?: unknown; profileId?: unknown };
  if (typeof tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(tokenHash)) return new Response("bad request", { status: 400 });
  const profile = typeof profileId === "number" ? services!.db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId)).get() : undefined;
  services!.db.insert(sessions).values({ tokenHash, userId: demoUser.id, profileId: profile?.id ?? null, deviceName: "Restored" }).onConflictDoNothing().run();
  return Response.json({ ok: true });
}

Bun.serve({
  hostname: "0.0.0.0",
  port,
  idleTimeout: 120,
  fetch: (req, server) => (new URL(req.url).pathname === "/__demo/restore-session" && req.method === "POST" ? restoreSession(req) : app.fetch(req, server)),
});
const matched = movies.length + shows.length;
const signIn = publicDemo ? "demo / strata-demo (viewer only)" : "Alex / demo-password";
console.log(`Strata demo ready on port ${port} (${matched} titles; data in ${dataDir}). Sign in as ${signIn}.`);
