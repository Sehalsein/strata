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
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/api/app";
import { sameSecret } from "../../src/secrets";
import type { Shelf, TitleCard } from "../../src/catalog/service";
import { imageUrl, type TmdbListItem } from "../../src/catalog/tmdb";
import { formatRef, tmdbRef } from "../../src/catalog/ref";
import { createServices, type Services } from "../../src/services";
import type { Household } from "../../src/household";
import { member, session, user } from "../../src/db/schema";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const media = arg("media", join(homedir(), "StrataDemo", "media"));
const port = Number(arg("port", "8460"));
const publicDemo = process.argv.includes("--public");
if (!process.env.TMDB_API_KEY) throw new Error("Set TMDB_API_KEY: the demo shows real TMDB details for its public-domain titles.");
process.env.STRATA_NO_JOBS = "1";

let services: Services | undefined;
let home: Household | undefined;

/** The library's titles as TMDB list items (from cached details). */
async function libraryItems(type: "movie" | "tv"): Promise<unknown[]> {
  if (!home) return [];
  const rows = await home.library.recentlyAdded(type === "movie" ? "movie" : "show", 50);
  const details = await Promise.all(rows.map((r) => (type === "movie" ? home!.tmdb.movie(r.titleId) : home!.tmdb.show(r.titleId)).catch(() => null)));
  return details
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({ ...d, media_type: type, genre_ids: d.genres.map((g) => g.id) }));
}

const isJapanese = (i: unknown) => (i as { original_language?: string }).original_language === "ja";
const page = (results: unknown[]) => Response.json({ page: 1, results, total_pages: 1, total_results: results.length });
const LISTS = /^\/3\/(trending\/(movie|tv)\/week|discover\/(movie|tv)|(movie|tv)\/(popular|top_rated|now_playing|on_the_air))$/;

/** TMDB with every list narrowed to the demo library; details pass through. Nothing else goes out. */
const demoFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.themoviedb.org") {
    const list = LISTS.exec(url.pathname);
    if (list) {
      const type = url.pathname.includes("/tv") ? "tv" : "movie";
      let items = await libraryItems(type);
      // Japanese animation (the anime rails): the library's own, from before 1946.
      if (url.searchParams.get("with_original_language") === "ja") items = items.filter(isJapanese);
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
        const ids = new Set((await home!.library.recentlyAdded(type, 100)).map((r) => r.titleId));
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

// Accounts, as setup makes them: the admin (Alex, or an unguessable one for the public
// demo) and their household, then its other members (the demo refuses admin routes).
const admin = publicDemo ? { username: `admin_${randomBytes(4).toString("hex")}`, password: randomBytes(24).toString("base64url") } : { username: "Alex", password: "demo-password" };
const setupApp = createApp(services);
const setup = await setupApp.fetch(
  new Request("http://demo/api/setup/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...admin, householdName: "The Demo House" }) }),
  { requestIP: () => ({ address: "127.0.0.1" }) },
);
const { householdId } = (await setup.json()) as { householdId: string };
home = await services.households.get(householdId);
// Keys are each household's own: the demo's one household gets the operator's TMDB key.
await home.settingsStore.setSecret("tmdbApiKey", process.env.TMDB_API_KEY!);
const alex = (await services.db.select({ id: user.id }).from(user).where(eq(user.username, admin.username)))[0]!;
const people = [
  { username: "Sam", password: "demo-password", isKids: false },
  { username: "Kids", password: "demo-password", isKids: true },
  ...(publicDemo ? [{ username: "demo", password: "strata-demo", isKids: false }] : []),
];
for (const p of people) {
  const made = await services.auth.api.createUser({ body: { email: `${p.username.toLowerCase()}@users.strata`, password: p.password, name: p.username, role: "user", data: { username: p.username } } });
  await services.auth.api.addMember({ body: { userId: made.user.id, organizationId: householdId, role: "member" } });
  if (p.isKids) await services.db.update(member).set({ isKids: true, contentLimit: "kids" }).where(eq(member.userId, made.user.id));
}
await services.settings.update({
  serverName: publicDemo ? "Strata Demo" : "Strata",
  // Nothing that reaches out or costs: no join without a password, no Bonjour.
  torrentioUrl: "",
  localJoin: false,
  bonjourEnabled: false,
  hardwareAcceleration: false,
  maxTranscodes: 1,
});
await home.settingsStore.update({
  mediaFolders: [{ path: join(media, "Movies"), kind: "movies" }, { path: join(media, "Shows"), kind: "shows" }],
  // No release search.
  discoveryEnabled: false,
  useTorboxSearch: false,
});
await services.jobs.run("scanLocal");
await home.library.matchPending();

// Something to continue, something next up, and a few saved for later (Alex's account).
// The anime keeps to its own rails, so these stay the same as the screenshots show.
const anime = new Set(((await libraryItems("movie")) as TmdbListItem[]).filter(isJapanese).map((f) => f.id));
const movies = (await home.library.recentlyAdded("movie", 20)).map((m) => m.titleId).filter((id) => !anime.has(id));
const shows = (await home.library.recentlyAdded("show", 20)).map((s) => s.titleId);
const minutes = (n: number) => n * 60_000;
// Positions inside the clips, which are 3 minutes long (fetch-media.ts), so resuming plays.
if (movies[0]) await services.progress.record(alex!.id, { source: "tmdb", mediaType: "movie", titleId: movies[0] }, minutes(1.3), minutes(3));
if (movies[2]) await services.progress.record(alex!.id, { source: "tmdb", mediaType: "movie", titleId: movies[2] }, minutes(0.6), minutes(3));
// An episode the library actually has (the demo carries a few per show, not whole seasons).
const episode = shows[0] ? (await home.library.filesFor(tmdbRef("show", shows[0]))).sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!))[0] : undefined;
if (episode) await services.progress.record(alex!.id, { source: "tmdb", mediaType: "episode", titleId: shows[0]!, season: episode.season!, episode: episode.episode! }, minutes(1), minutes(3));
for (const id of movies.slice(3, 6)) await services.progress.setWatchlist(alex!.id, tmdbRef("movie", id), true);
if (shows[1]) await services.progress.setWatchlist(alex!.id, tmdbRef("show", shows[1]), true);

// The Anime tab ranks titles with Kitsu, which the demo can't reach: here it's the
// library's Japanese animation, with no categories to filter by.
home.catalog.animeCategories = () => [];
home.catalog.animePage = async (category?: string): Promise<Shelf[]> => {
  if (category) return [];
  const films = ((await libraryItems("movie")) as TmdbListItem[]).filter(isJapanese);
  const available = await home!.library.availability(films.map((f) => tmdbRef("movie", f.id)));
  const items: TitleCard[] = films.map((f) => ({
    type: "movie",
    ref: formatRef(tmdbRef("movie", f.id)),
    tmdbId: f.id,
    title: f.title ?? "",
    year: f.release_date ? Number(f.release_date.slice(0, 4)) : null,
    overview: f.overview,
    posterUrl: imageUrl(f.poster_path, "w342"),
    backdropUrl: imageUrl(f.backdrop_path, "w780"),
    rating: f.vote_average,
    available: available.get(formatRef(tmdbRef("movie", f.id))) ?? [],
  }));
  return items.length ? [{ id: "anime-demo-classics", title: "Classic Anime", kind: "titles", items }] : [];
};

/**
 * The hosted demo starts from scratch whenever its container wakes, which would sign
 * everyone out. Its Worker (deploy/cloudflare-demo) remembers each sign-in it saw (by the
 * token's hash) and, when one comes back to an empty server, asks here to put it back: the
 * same token, for the same account (a TV's is the demo account's), in the demo household.
 * The server's key comes from the Worker too, so the token's signature still holds. Only
 * with the restore key, which only the Worker has.
 */
async function restoreSession(req: Request): Promise<Response> {
  const key = process.env.DEMO_RESTORE_KEY ?? "";
  const given = req.headers.get("X-Demo-Key") ?? "";
  if (!key || !sameSecret(given, key)) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => null)) as { token?: unknown; username?: unknown; viewerOnly?: unknown } | null;
  const token = typeof body?.token === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(body.token) ? body.token : null;
  if (!token) return Response.json({ error: "Bad request" }, { status: 400 });
  const username = typeof body?.username === "string" ? body.username : publicDemo ? "demo" : admin.username;
  const [account] = await services!.db.select({ id: user.id }).from(user).where(eq(user.username, username));
  if (!account) return Response.json({ error: "No such account" }, { status: 404 });
  const now = new Date();
  await services!.db
    .insert(session)
    .values({ id: randomUUID(), token, userId: account.id, activeOrganizationId: householdId, viewerOnly: body?.viewerOnly === true, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) })
    .onConflictDoNothing();
  return Response.json({ ok: true });
}

// Only now, with the demo set up: admin routes and changes to the accounts and households
// are refused from here on (auth/permissions.ts, auth/betterAuth.ts). Seeding above needs them.
if (publicDemo) services.profile.readOnly = true;

const app = createApp(services);
Bun.serve({
  hostname: "0.0.0.0",
  port,
  idleTimeout: 120,
  fetch: (req, server) => (new URL(req.url).pathname === "/__demo/restore-session" && req.method === "POST" ? restoreSession(req) : app.fetch(req, server)),
});
const matched = movies.length + shows.length;
const signIn = publicDemo ? "demo / strata-demo (viewer only)" : "Alex / demo-password";
console.log(`Strata demo ready on port ${port} (${matched} titles; data in ${dataDir}). Sign in as ${signIn}.`);
