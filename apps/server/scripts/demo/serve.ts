// A demo Strata server for App Store screenshots and trying the apps: a library of
// public-domain films and episodes (see fetch-media.ts), real TMDB details for them,
// and every catalog list (trending, new, popular, recommendations…) limited to that
// library, so no current, copyrighted titles appear anywhere.
//
//   TMDB_API_KEY=… bun scripts/demo/serve.ts [--media ~/StrataDemo/media] [--port 8460]
//
// Sign in as "Alex" / "demo-password". Profiles: Alex, Sam, Kids.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/api/app";
import { createServices, type Services } from "../../src/services";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const media = arg("media", join(homedir(), "StrataDemo", "media"));
const port = Number(arg("port", "8460"));
if (!process.env.TMDB_API_KEY) throw new Error("Set TMDB_API_KEY: the demo shows real TMDB details for its public-domain titles.");
process.env.STRATA_NO_JOBS = "1";

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

/** TMDB with every list narrowed to the demo library; details pass through. */
const demoFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
  // Anime rankings, AniList, the anime id list: none in the demo.
  if (/kitsu\.app|anilist\.co|githubusercontent\.com/.test(url.hostname)) return new Response("not in the demo", { status: 404 });
  return fetch(input, init);
}) as typeof fetch;

const dataDir = mkdtempSync(join(tmpdir(), "strata-demo-"));
services = await createServices({ dataDir, port, host: "0.0.0.0" }, { fetch: demoFetch });
const app = createApp(services);
const server = Bun.serve({ hostname: "0.0.0.0", port, fetch: app.fetch, idleTimeout: 120 });
const base = `http://127.0.0.1:${server.port}`;
const api = async (path: string, init: { method?: string; token?: string; json?: unknown } = {}) =>
  (await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  })).json() as Promise<any>;

const { token } = await api("/api/setup/admin", { method: "POST", json: { username: "Alex", password: "demo-password" } });
await api("/api/profiles", { method: "POST", token, json: { name: "Sam" } });
await api("/api/profiles", { method: "POST", token, json: { name: "Kids", isKids: true } });
await api("/api/admin/settings", {
  method: "PATCH",
  token,
  json: { serverName: "Strata", mediaFolders: [{ path: join(media, "Movies"), kind: "movies" }, { path: join(media, "Shows"), kind: "shows" }] },
});
await services.jobs.run("scanLocal");
await services.library.matchPending();

// Something to continue, something next up, and a few saved for later (Alex's profile).
const alex = 1;
const movies = services.library.recentlyAdded("movie", 20).map((m) => m.tmdbId);
const shows = services.library.recentlyAdded("show", 20).map((s) => s.tmdbId);
const minutes = (n: number) => n * 60_000;
if (movies[0]) services.progress.record(alex, { mediaType: "movie", tmdbId: movies[0] }, minutes(41), minutes(96));
if (movies[2]) services.progress.record(alex, { mediaType: "movie", tmdbId: movies[2] }, minutes(18), minutes(92));
if (shows[0]) services.progress.record(alex, { mediaType: "episode", tmdbId: shows[0], season: 1, episode: 7 }, minutes(11), minutes(25));
for (const id of movies.slice(3, 6)) services.progress.setWatchlist(alex, "movie", id, true);
if (shows[1]) services.progress.setWatchlist(alex, "show", shows[1], true);

const matched = services.library.recentlyAdded("movie", 50).length + services.library.recentlyAdded("show", 50).length;
console.log(`Strata demo ready on ${base} (${matched} titles; data in ${dataDir}). Sign in as Alex / demo-password.`);
