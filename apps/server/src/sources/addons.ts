import { z } from "zod";
import { isVideoFile, type ParsedName } from "../media/parse";
import { globalFetch } from "../net";
import { runtime } from "#runtime";

/** One of an add-on's catalogs (a list of titles), and whether Home shows it as a row. */
export const addonCatalogSchema = z.object({
  type: z.enum(["movie", "series"]),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  home: z.boolean().default(false),
});
export type AddonCatalog = z.infer<typeof addonCatalogSchema>;

/** A catalog's key within its add-on ("movie/tmdb.trending"). */
export const catalogKey = (c: Pick<AddonCatalog, "type" | "id">) => `${c.type}/${c.id}`;

/**
 * A Stremio add-on a household uses: one that finds releases (Torrentio, AIOStreams, Comet,
 * MediaFusion…: anything that answers `/stream/{movie|series}/{id}.json`), one that finds
 * subtitles (OpenSubtitles v3: `/subtitles/…`), one with catalogs of titles (AIO Metadata:
 * `/catalog/…`), or several of these. Kept sealed, since their URLs often carry a password
 * or a debrid key.
 */
export const streamAddonSchema = z.object({
  id: z.string().min(1),
  /** The manifest URL, ending in /manifest.json. */
  url: z.string().url(),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  /** What it's asked for. Lists saved before subtitles came along only find streams. */
  resources: z.array(z.enum(["stream", "subtitles", "catalog"])).min(1).default(["stream"]),
  /** The ids it finds streams for ("tt", "kitsu"…), from its manifest; null when it doesn't say. */
  idPrefixes: z.array(z.string()).nullable().default(null),
  /** The ids it finds subtitles for; null when it doesn't say. */
  subtitleIdPrefixes: z.array(z.string()).nullable().default(null),
  /** Its catalogs of movies and shows that need nothing filled in, in its order. */
  catalogs: z.array(addonCatalogSchema).default([]),
  /**
   * AIOStreams also has a search API that says what Stremio's streams leave out (hashes).
   * "strata" is the built-in entry (see strataAddon): no manifest, the server's own sources.
   */
  kind: z.enum(["stremio", "aiostreams", "strata"]).default("stremio"),
  /** It has a configure page (<base>/configure), per its manifest. */
  configurable: z.boolean().default(false),
  /**
   * It may be on this machine or the home network: only the server's admin can add one
   * like that (a household's admin mustn't make the server reach its private network).
   */
  allowPrivate: z.boolean().default(false),
});
export type StreamAddon = z.infer<typeof streamAddonSchema>;
export const streamAddonListSchema = z.array(streamAddonSchema);

export const STRATA_ADDON_ID = "strata";

/**
 * The built-in "Strata" entry: the server's Torrentio, TorBox's own search and its cache
 * check, as one add-on a household can move or switch off (never remove). Its address is
 * a placeholder: it's never fetched.
 */
export function strataAddon(enabled = true): StreamAddon {
  return { id: STRATA_ADDON_ID, url: "strata://builtin/manifest.json", name: "Strata", enabled, resources: ["stream"], idPrefixes: ["tt", "kitsu"], subtitleIdPrefixes: null, catalogs: [], kind: "strata", configurable: false, allowPrivate: true };
}

export const isBuiltIn = (a: Pick<StreamAddon, "kind">) => a.kind === "strata";

/** What a household has before it sets up its own list: the Strata entry. */
export function defaultAddons(): StreamAddon[] {
  return [strataAddon()];
}

/**
 * A saved list with the Strata entry in it: the old built-in Torrentio ("default") becomes
 * it, in its place and with its switch; a list without either gets it first.
 */
export function withStrata(list: StreamAddon[]): StreamAddon[] {
  if (list.some(isBuiltIn)) return list;
  const legacy = list.findIndex((a) => a.id === "default");
  if (legacy >= 0) return list.map((a, i) => (i === legacy ? strataAddon(a.enabled) : a));
  return [strataAddon(), ...list];
}

/** A pasted add-on address as its manifest URL: stremio:// becomes https://, /manifest.json is added. */
export function manifestUrl(input: string): string {
  let url = input.trim().replace(/^stremio:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) throw new AddonError("Enter the add-on's full address (https://…/manifest.json).");
  url = url.replace(/\/+$/, "");
  if (!/\/manifest\.json$/i.test(url)) url += "/manifest.json";
  try {
    new URL(url);
  } catch {
    throw new AddonError("That isn't a valid address.");
  }
  return url;
}

/** The add-on's base URL, that its resources hang off. */
export function addonBase(url: string): string {
  return url.replace(/\/manifest\.json$/i, "").replace(/\/+$/, "");
}

/** The add-on's address without its path, which is where any password or key lives. */
export function addonOrigin(url: string): string {
  return new URL(url).host;
}

export class AddonError extends Error {}

/** Largest answer read from an add-on (a manifest, or a title's streams). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Fetches from an add-on. Unless it may be private, its host must be public (checked
 * again on every request, since DNS can change), and redirects aren't followed: one
 * could lead anywhere.
 */
async function addonFetch(url: string, allowPrivate: boolean, fetchImpl: typeof fetch, init: RequestInit = {}): Promise<Response> {
  if (!allowPrivate) await assertPublicHost(url);
  const res = await fetchImpl(url, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (res.status >= 300 && res.status < 400) throw new AddonError("That add-on redirected elsewhere, which Strata doesn't follow. Use the address it redirects to.");
  return res;
}

/** The body as JSON, refusing one past MAX_BODY_BYTES. */
async function readJson(res: Response): Promise<unknown> {
  const bytes = await readBytes(res, MAX_BODY_BYTES);
  return bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : null;
}

/** The body, refusing one past `max` bytes. */
async function readBytes(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error("Add-on answer too large");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("Add-on answer too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

/**
 * Refuses an address on this machine, the home network or the cloud host's own network
 * (loopback, private, link-local, CGNAT, multicast, metadata), by name or by what the name
 * resolves to, and addresses with a user name or password in them.
 */
export async function assertPublicHost(url: string): Promise<void> {
  const u = new URL(url);
  const refuse = () => {
    throw new AddonError("Add-ons on this server or its home network can only be added by the server's admin.");
  };
  if (u.username || u.password) throw new AddonError("Leave the user name and password out of the address.");
  const host = u.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || (!host.includes(".") && !host.includes(":"))) refuse();
  if (/\.(local|lan|home|internal|home\.arpa|localdomain)$/.test(host)) refuse();
  if (isIpLiteral(host)) {
    if (!isPublicAddress(host)) refuse();
    return;
  }
  // Workers can't reach private networks at all; on Bun, look at what the name points to.
  // (The fetch looks it up again: a name rebound in between isn't caught. Redirects are
  // off and only torrent-shaped answers are used, which limits what that could reach.)
  if (runtime.name !== "bun") return;
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new AddonError("Couldn't find that add-on's address.");
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a))) refuse();
}

let resolveHost = async (host: string): Promise<string[]> => {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
};

/** For tests: how names are looked up. */
export function setResolverForTests(fn: (host: string) => Promise<string[]>) {
  resolveHost = fn;
}

/** An IP address rather than a name (URL parsing has already put IPv4 in dotted form). */
function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(":");
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(raw: string): boolean {
  let address = raw.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) address = mapped[1]!;
  if (/^[\d.]+$/.test(address)) {
    // Strictly dotted-decimal, four octets of 0–255 without leading zeros; anything else isn't trusted.
    const octets = address.split(".");
    if (octets.length !== 4 || octets.some((o) => !/^(0|[1-9]\d{0,2})$/.test(o) || Number(o) > 255)) return false;
    const [a, b] = [Number(octets[0]), Number(octets[1])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    return true;
  }
  if (!/^[0-9a-f:]+$/.test(address) || !address.includes(":")) return false;
  // Unspecified, loopback and IPv4-compatible (::a.b.c.d / ::7f00:1): the high bits are all zero.
  if (address.startsWith("::")) return false;
  if (/^2002:/.test(address)) return false; // 6to4: wraps an IPv4 address
  if (/^f[cd]/.test(address) || /^fe[89ab]/.test(address) || /^ff/.test(address)) return false; // unique-local, link-local, multicast
  if (/^::ffff:/.test(address) || /^64:ff9b:/.test(address)) return false; // other mapped / NAT64 forms
  return true;
}

const manifestSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  resources: z.array(z.union([z.string(), z.object({ name: z.string(), types: z.array(z.string()).optional(), idPrefixes: z.array(z.string()).optional() })])).default([]),
  types: z.array(z.string()).default([]),
  idPrefixes: z.array(z.string()).optional(),
  behaviorHints: z.object({ configurable: z.boolean().optional(), configurationRequired: z.boolean().optional() }).passthrough().optional(),
  catalogs: z
    .array(
      z
        .object({
          type: z.string(),
          id: z.string(),
          name: z.string().optional(),
          extra: z.array(z.object({ name: z.string(), isRequired: z.boolean().optional() }).passthrough()).optional(),
          extraRequired: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .catch([])
    .default([]),
});

/** Catalogs Home rows start with when an add-on is added: its first few. */
const HOME_CATALOGS_AT_FIRST = 3;
/** Add-on rows Home shows at most, across all of a household's add-ons (each is a fan-out of lookups). */
export const MAX_HOME_ROWS = 12;

/** Reads an add-on's manifest and checks it can find streams or subtitles for movies or shows. */
export async function inspectAddon(input: string, fetchImpl: typeof fetch = globalFetch, allowPrivate = false): Promise<Omit<StreamAddon, "id" | "enabled">> {
  const url = manifestUrl(input);
  let res: Response;
  try {
    res = await addonFetch(url, allowPrivate, fetchImpl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    if (err instanceof AddonError) throw err;
    throw new AddonError("Couldn't reach that add-on.");
  }
  if (!res.ok) throw new AddonError(`That add-on answered ${res.status}. Check the address (and that it's set up, for ones that need it).`);
  const parsed = manifestSchema.safeParse(await readJson(res).catch(() => null));
  if (!parsed.success) throw new AddonError("That address isn't a Stremio add-on manifest.");
  const m = parsed.data;
  const label = m.name ?? "That add-on";
  if (m.behaviorHints?.configurationRequired) throw new AddonError(needsSetup(label));
  const resource = (name: "stream" | "subtitles") => {
    const r = m.resources.find((x) => (typeof x === "string" ? x : x.name) === name);
    if (!r) return null;
    const types = (typeof r === "object" && r.types) || m.types;
    if (!types.some((t) => t === "movie" || t === "series")) return null;
    return { idPrefixes: (typeof r === "object" && r.idPrefixes) || m.idPrefixes || null };
  };
  const stream = resource("stream");
  const subtitles = resource("subtitles");
  // Catalogs Strata can show as rows: of movies or shows, needing no genre or search filled in.
  const offersCatalogs = m.resources.some((r) => (typeof r === "string" ? r : r.name) === "catalog");
  const catalogs: AddonCatalog[] = offersCatalogs
    ? m.catalogs
        .filter((c) => (c.type === "movie" || c.type === "series") && !c.extra?.some((e) => e.isRequired) && !c.extraRequired?.length)
        .slice(0, 100)
        .map((c, i) => ({ type: c.type as "movie" | "series", id: c.id.slice(0, 200), name: (c.name?.trim() || c.id).slice(0, 100), home: i < HOME_CATALOGS_AT_FIRST }))
    : [];
  if (!stream && !subtitles && !catalogs.length) {
    const offered = m.resources.some((r) => ["stream", "subtitles", "catalog"].includes(typeof r === "string" ? r : r.name));
    throw new AddonError(offered ? `${label} doesn't have movies or shows.` : `${label} doesn't find streams, subtitles or catalogs, so Strata can't use it.`);
  }
  const aio = !!stream && /aiostreams/i.test(`${m.id ?? ""} ${m.name ?? ""}`) && aioCredentials(url) !== null;
  return {
    url,
    name: (m.name ?? addonOrigin(url)).slice(0, 100),
    resources: [...(stream ? (["stream"] as const) : []), ...(subtitles ? (["subtitles"] as const) : []), ...(catalogs.length ? (["catalog"] as const) : [])],
    idPrefixes: stream?.idPrefixes ?? null,
    subtitleIdPrefixes: subtitles?.idPrefixes ?? null,
    catalogs,
    kind: aio ? "aiostreams" : "stremio",
    configurable: !!m.behaviorHints?.configurable,
    allowPrivate,
  };
}

const needsSetup = (name: string) =>
  `${name} needs setting up first. Open its configure page, set it up (most want your TorBox key), and paste the manifest URL it gives you.`;

/** A film every stream add-on has, to see whether a new one answers with anything usable. */
const KNOWN_MOVIE = "tt0111161";

/**
 * Refuses a stream add-on that answers but isn't set up: one that turns the request away
 * (401/403) or answers only with a "configure this add-on" note, as Comet and Jackettio do
 * at their bare address. Anything else (no answer, nothing for this film) is let through:
 * it may only have some titles. Subtitle-only add-ons say so in their manifest instead.
 */
export async function assertAddonReady(addon: Omit<StreamAddon, "id" | "enabled">, fetchImpl: typeof fetch = globalFetch): Promise<void> {
  if (!addon.resources.includes("stream") || addon.kind === "aiostreams") return;
  let res: Response;
  try {
    res = await addonFetch(`${addonBase(addon.url)}/stream/movie/${KNOWN_MOVIE}.json`, addon.allowPrivate, fetchImpl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return;
  }
  if (res.status === 401 || res.status === 403) throw new AddonError(needsSetup(addon.name));
  if (!res.ok) return;
  const body = (await readJson(res).catch(() => null)) as { streams?: StremioStream[] } | null;
  const streams = body?.streams ?? [];
  const asksForSetup = (st: StremioStream) => /configur|set ?up|api ?key|debrid|install/i.test(`${st.name ?? ""} ${st.title ?? ""} ${st.description ?? ""}`);
  if (streams.length && streams.every((st) => !streamHash(st) && asksForSetup(st))) throw new AddonError(needsSetup(addon.name));
}

/** Whether an add-on is asked for streams / subtitles. */
export const findsStreams = (a: StreamAddon) => a.resources.includes("stream");
export const findsSubtitles = (a: StreamAddon) => a.resources.includes("subtitles");
export const hasCatalogs = (a: StreamAddon) => a.resources.includes("catalog") && a.catalogs.length > 0;

/**
 * A manifest read again: its catalogs as it lists them now, keeping which ones the
 * household put on Home (new ones start off).
 */
export function keepCatalogChoices(fresh: AddonCatalog[], before: AddonCatalog[]): AddonCatalog[] {
  if (!before.length) return fresh;
  const chosen = new Map(before.map((c) => [catalogKey(c), c.home]));
  return fresh.map((c) => ({ ...c, home: chosen.get(catalogKey(c)) ?? false }));
}

/** A title in an add-on's catalog, as far as a Home row needs it. */
export interface AddonMeta {
  /** Its id in the add-on: "tt0111161", "tmdb:278", "kitsu:1376", "mal:5114"… */
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  /** "1994", "2008-2013". */
  releaseInfo?: string;
  imdbRating?: number;
}

/** The titles in one of an add-on's catalogs, first page. */
export async function addonCatalogItems(addon: StreamAddon, catalog: Pick<AddonCatalog, "type" | "id">, fetchImpl: typeof fetch = globalFetch): Promise<AddonMeta[]> {
  // Catalogs are public lists, often served from elsewhere (Cinemeta redirects to its own catalog host).
  const res = await fetchFollowing(`${addonBase(addon.url)}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}.json`, addon, fetchImpl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await readJson(res)) as { metas?: Record<string, unknown>[] } | null;
  const text = (v: unknown, max = 2048) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const image = (v: unknown) => {
    const u = text(v);
    return u && /^https:\/\//i.test(u) ? u : undefined;
  };
  return (body?.metas ?? []).slice(0, 100).flatMap((m) => {
    const id = text(m.id, 100);
    const name = text(m.name, 300);
    if (!id || !name) return [];
    const rating = Number(m.imdbRating);
    return [
      {
        id,
        type: m.type === "series" ? "series" : catalog.type,
        name,
        poster: image(m.poster),
        background: image(m.background),
        description: text(m.description, 1000),
        releaseInfo: text(m.releaseInfo ?? m.year, 20),
        imdbRating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      },
    ];
  });
}

/** A subtitle an add-on found: its file's address and language. */
export interface AddonSubtitle {
  /** The add-on's own id for it, when it gives one. */
  id?: string;
  url: string;
  /** As the add-on gives it: usually ISO 639-2 ("eng", "pob"…). */
  lang: string;
}

/**
 * Subtitles for `id` (an IMDb id, "tt…:S:E", or "kitsu:…"). `extra` helps it match the
 * release (OpenSubtitles goes by file name and size).
 */
export async function addonSubtitles(
  addon: StreamAddon,
  type: "movie" | "series",
  id: string,
  extra: { filename?: string; videoSize?: number } = {},
  fetchImpl: typeof fetch = globalFetch,
  signal?: AbortSignal,
): Promise<AddonSubtitle[]> {
  const params = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const path = `${addonBase(addon.url)}/subtitles/${type}/${encodeURIComponent(id)}${params ? `/${params}` : ""}.json`;
  const res = await addonFetch(path, addon.allowPrivate, fetchImpl, { headers: { Accept: "application/json" }, signal: signal ?? AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await readJson(res)) as { subtitles?: { id?: unknown; url?: unknown; lang?: unknown }[] } | null;
  return (body?.subtitles ?? []).flatMap((s) => {
    if (typeof s.url !== "string" || !/^https?:\/\//i.test(s.url)) return [];
    return [{ id: typeof s.id === "string" || typeof s.id === "number" ? String(s.id) : undefined, url: s.url, lang: typeof s.lang === "string" ? s.lang : "und" }];
  });
}

/** Largest subtitle file read (a film's worth of lines is well under 1 MB). */
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

/**
 * A subtitle file's bytes, for one of `addon`'s subtitles. Subtitle hosts often redirect to
 * where the file is (see fetchFollowing).
 */
export async function fetchSubtitleFile(url: string, addon: Pick<StreamAddon, "url" | "allowPrivate">, fetchImpl: typeof fetch = globalFetch): Promise<Uint8Array> {
  const res = await fetchFollowing(url, addon, fetchImpl);
  if (!res.ok) throw new Error(`Subtitle download ${res.status}`);
  return readBytes(res, MAX_SUBTITLE_BYTES);
}

/**
 * Where an add-on's playback link leads now: the file's own address after its redirects (a
 * debrid service's download link), checked hop by hop like any add-on address. Nothing is
 * downloaded: only the first byte is asked for. A link that answers itself (the add-on
 * serves the file) is its own address.
 */
export async function followLink(url: string, addon: Pick<StreamAddon, "url" | "allowPrivate">, fetchImpl: typeof fetch = globalFetch): Promise<string> {
  const { res, url: at } = await fetchFollowingAt(url, addon, fetchImpl, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(20_000) });
  await res.body?.cancel().catch(() => {});
  if (!res.ok) throw new Error(`Link answered ${res.status}`);
  return at;
}

/**
 * Fetches something public an add-on points to (a subtitle file, a catalog, a playback
 * link), following up to five redirects, each checked like the first address. An add-on the server's admin
 * let be on the home network may serve from its own host there, but it can't send Strata
 * anywhere else on that network.
 */
async function fetchFollowing(url: string, addon: Pick<StreamAddon, "url" | "allowPrivate">, fetchImpl: typeof fetch, init: RequestInit = {}): Promise<Response> {
  return (await fetchFollowingAt(url, addon, fetchImpl, init)).res;
}

/** fetchFollowing, with the address it ended up at. */
async function fetchFollowingAt(url: string, addon: Pick<StreamAddon, "url" | "allowPrivate">, fetchImpl: typeof fetch, init: RequestInit = {}): Promise<{ res: Response; url: string }> {
  const ownHost = new URL(addon.url).host;
  let at = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:\/\//i.test(at)) throw new AddonError("That address isn't a web address.");
    if (!(addon.allowPrivate && new URL(at).host === ownHost)) await assertPublicHost(at);
    const res = await fetchImpl(at, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error(`${res.status} without a location`);
      await res.body?.cancel().catch(() => {});
      at = new URL(next, at).toString();
      continue;
    }
    return { res, url: at };
  }
  throw new Error("Redirected too many times");
}

/**
 * A stream an add-on found, as far as discovery cares: a torrent (`hash`), or a link the
 * add-on plays from itself (`link`: a debrid add-on's own playback address), with what's
 * known about it.
 */
export interface AddonStream {
  hash?: string;
  /** For a stream without a torrent: the address to play it from (followed when played). */
  link?: string;
  title: string;
  fileName?: string;
  size?: number;
  seeders?: number;
  resolution?: number;
  /** The add-on says TorBox has it cached (AIOStreams' TorBox check, Torrentio's [TB+]). */
  cached?: boolean;
  /** Audio languages, as ISO 639-1 codes ("multi" for several), when the add-on says. */
  languages?: string[];
  hdr?: ParsedName["hdr"];
  videoCodec?: ParsedName["videoCodec"];
}

/**
 * Streams for `id` (an IMDb id, "tt…:S:E", or "kitsu:…"): torrents, which discovery adds to
 * TorBox itself, and links (debrid add-ons' own playback addresses, usenet), played from
 * where they point. Links that need request headers the apps can't send, or that only ask
 * for the add-on to be set up, are left out.
 */
export async function addonStreams(addon: StreamAddon, type: "movie" | "series", id: string, fetchImpl: typeof fetch = globalFetch): Promise<AddonStream[]> {
  if (addon.kind === "aiostreams") {
    const viaSearch = await aioSearch(addon, type, id, fetchImpl);
    // Its search only lists torrents; set up with a debrid service, its streams are links.
    if (viaSearch?.length) return viaSearch;
  }
  const res = await addonFetch(`${addonBase(addon.url)}/stream/${type}/${id}.json`, addon.allowPrivate, fetchImpl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await readJson(res)) as { streams?: StremioStream[] } | null;
  return (body?.streams ?? []).flatMap((s) => {
    const hash = streamHash(s) ?? undefined;
    const link = hash ? undefined : playableLink(s);
    if (!hash && !link) return [];
    const lines = (s.title ?? s.description ?? "").split("\n");
    const hintName = s.behaviorHints?.filename ?? s.streamData?.filename ?? undefined;
    const title = s.streamData?.folderName || lines[0]?.trim() || hintName || "";
    const fileName = hintName ?? (lines[1] && isVideoFile(lines[1].trim()) ? lines[1].trim() : undefined);
    const meta = lines.join(" ");
    const parsedFile = s.streamData?.parsedFile;
    const service = s.streamData?.service;
    const languages = parsedFile?.languages?.length ? languageCodes(parsedFile.languages) : languagesFromText(meta);
    return [
      {
        hash,
        link,
        title,
        fileName,
        size: s.behaviorHints?.videoSize ?? s.streamData?.size ?? parseSize(meta),
        seeders: s.streamData?.torrent?.seeders ?? (Number(/👤\s*(\d+)/.exec(meta)?.[1] ?? 0) || undefined),
        resolution: resolutionFrom(parsedFile?.resolution) ?? resolutionFromName(s.name),
        cached: link ? linkCached(s) : service ? service.id === "torbox" && service.cached === true : /\[TB\+\]/.test(s.name ?? ""),
        languages: languages.length ? languages : undefined,
        hdr: hdrFrom(parsedFile?.visualTags),
        videoCodec: codecFrom(parsedFile?.encode),
      },
    ];
  });
}

interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  infoHash?: string;
  url?: string;
  fileIdx?: number;
  behaviorHints?: { filename?: string; videoSize?: number; bingeGroup?: string; proxyHeaders?: unknown };
  /** AIOStreams' structured copy, on instances that hand it out. */
  streamData?: {
    filename?: string;
    folderName?: string;
    size?: number;
    torrent?: { infoHash?: string; seeders?: number };
    service?: { id?: string; cached?: boolean };
    parsedFile?: AioParsedFile;
  };
}

/** What AIOStreams parsed from a release's name. */
interface AioParsedFile {
  resolution?: string;
  encode?: string;
  visualTags?: string[];
  languages?: string[];
}

/**
 * A stream's own playback address, when it has one Strata can hand to the apps: https, no
 * request headers needed, and not a note asking for the add-on to be set up.
 */
function playableLink(s: StremioStream): string | undefined {
  if (!s.url || !/^https:\/\//i.test(s.url) || s.url.length > 4096) return undefined;
  if (s.behaviorHints?.proxyHeaders) return undefined;
  if (/configur|set ?up|api ?key|install/i.test(`${s.name ?? ""} ${s.title ?? ""} ${s.description ?? ""}`) && !s.behaviorHints?.filename) return undefined;
  try {
    new URL(s.url);
  } catch {
    return undefined;
  }
  return s.url;
}

/**
 * Whether a link stream plays right away: the add-on's own word (AIOStreams' service
 * state) or the marks debrid add-ons put in names (⚡, "+]" as in "[TB+]"); "⬇"/"⏳" mean
 * it has to download first. Unmarked links are taken as ready.
 */
function linkCached(s: StremioStream): boolean {
  if (s.streamData?.service?.cached !== undefined) return s.streamData.service.cached === true;
  const text = `${s.name ?? ""} ${s.title ?? ""}`;
  if (/⬇|⏳|uncached|download/i.test(text)) return false;
  return true;
}

/**
 * The stream's info-hash: given, in its group label (Comet's), or in a debrid link
 * (Torrentio's /resolve/torbox/<key>/<hash>/…).
 */
function streamHash(s: StremioStream): string | null {
  const given = (s.infoHash ?? s.streamData?.torrent?.infoHash)?.toLowerCase();
  if (given && isInfoHash(given)) return given;
  // In the stream's group label: Comet's torrent mode says "comet|torrent|<hash>".
  const grouped = s.behaviorHints?.bingeGroup?.split("|").find((p) => /^[0-9a-f]{40}$/i.test(p));
  if (grouped) return grouped.toLowerCase();
  if (!s.url) return null;
  let path: string;
  try {
    path = new URL(s.url).pathname;
  } catch {
    return null;
  }
  const segment = path.split("/").find((p) => /^[0-9a-f]{40}$/i.test(p));
  return segment?.toLowerCase() ?? null;
}

/** The uuid and (encrypted) password in an AIOStreams manifest URL: /stremio/<uuid>/<password>/manifest.json. */
function aioCredentials(url: string): { root: string; uuid: string; password: string } | null {
  const u = new URL(url);
  const m = /^(.*)\/stremio\/([^/]+)\/([^/]+)\/manifest\.json$/i.exec(u.pathname);
  if (!m) return null;
  return { root: `${u.origin}${m[1]}`, uuid: decodeURIComponent(m[2]!), password: decodeURIComponent(m[3]!) };
}

interface AioResult {
  infoHash: string | null;
  filename: string | null;
  folderName: string | null;
  size: number | null;
  folderSize: number | null;
  seeders: number | null;
  service?: string | null;
  cached?: boolean | null;
  parsedFile?: AioParsedFile;
}

/**
 * AIOStreams' search API (/api/v1/search), which gives hashes even for debrid results
 * (its Stremio streams only give its own playback links). Null when the instance has it
 * turned off, so the caller falls back to the Stremio endpoint.
 */
async function aioSearch(addon: StreamAddon, type: "movie" | "series", id: string, fetchImpl: typeof fetch): Promise<AddonStream[] | null> {
  const creds = aioCredentials(addon.url);
  if (!creds) return null;
  const params = new URLSearchParams({ type, id, requiredFields: "infoHash" });
  const res = await addonFetch(`${creds.root}/api/v1/search?${params}`, addon.allowPrivate, fetchImpl, {
    headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${creds.uuid}:${creds.password}`)}` },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await readJson(res)) as { success?: boolean; data?: { results?: AioResult[] } | null; error?: { message?: string } | null } | null;
  if (!body?.success) throw new Error(`${addon.name}: ${body?.error?.message ?? "search failed"}`);
  return (body.data?.results ?? []).flatMap((r) => {
    const hash = r.infoHash?.toLowerCase();
    if (!hash || !isInfoHash(hash)) return [];
    const languages = languageCodes(r.parsedFile?.languages ?? []);
    return [
      {
        hash,
        title: r.folderName || r.filename || "",
        fileName: r.filename ?? undefined,
        size: r.size ?? r.folderSize ?? undefined,
        seeders: r.seeders ?? undefined,
        resolution: resolutionFrom(r.parsedFile?.resolution),
        cached: r.service === "torbox" && r.cached === true,
        languages: languages.length ? languages : undefined,
        hdr: hdrFrom(r.parsedFile?.visualTags),
        videoCodec: codecFrom(r.parsedFile?.encode),
      },
    ];
  });
}

/** SHA-1 (v1) or SHA-256 (v2) BitTorrent info-hash, hex. */
export function isInfoHash(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

export function parseSize(text: string): number | undefined {
  const m = /💾\s*([\d.]+)\s*(TB|GB|MB|KB)/i.exec(text) ?? /\b([\d.]+)\s*(TB|GB|MB)\b/i.exec(text);
  if (!m) return undefined;
  const mult = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[m[2]!.toUpperCase() as "TB" | "GB" | "MB" | "KB"];
  return Math.round(Number(m[1]) * mult);
}

function resolutionFromName(name?: string): number | undefined {
  if (!name) return undefined;
  if (/4k|2160/i.test(name)) return 2160;
  const m = /(1080|720|480)p?/i.exec(name);
  return m ? Number(m[1]) : undefined;
}

/** "2160p", "1080p"… as a number; "4k" as 2160. */
function resolutionFrom(text?: string): number | undefined {
  if (!text) return undefined;
  if (/4k/i.test(text)) return 2160;
  return Number(/(\d{3,4})p/i.exec(text)?.[1]) || undefined;
}

/** AIOStreams' visual tags ("DV", "HDR+DV", "HDR10+"…) as the best HDR format they name. */
function hdrFrom(tags?: string[]): ParsedName["hdr"] {
  if (!tags?.length) return undefined;
  const has = (t: string) => tags.some((x) => x.toUpperCase().includes(t));
  if (has("DV")) return "dv";
  if (has("HDR10+")) return "hdr10+";
  if (has("HDR")) return "hdr10";
  if (has("HLG")) return "hlg";
  return undefined;
}

function codecFrom(encode?: string): ParsedName["videoCodec"] {
  const e = encode?.toUpperCase();
  return e === "HEVC" ? "hevc" : e === "AVC" ? "h264" : e === "AV1" ? "av1" : undefined;
}

/** Language names (AIOStreams') as ISO 639-1 codes; several-language releases as "multi". */
const LANGUAGE_NAMES: Record<string, string> = {
  english: "en", japanese: "ja", chinese: "zh", mandarin: "zh", cantonese: "zh", korean: "ko", french: "fr", german: "de", spanish: "es", latino: "es",
  "spanish (latino)": "es", italian: "it", portuguese: "pt", "portuguese (brazil)": "pt", russian: "ru", hindi: "hi", tamil: "ta", telugu: "te", malayalam: "ml",
  kannada: "kn", bengali: "bn", arabic: "ar", turkish: "tr", dutch: "nl", polish: "pl", swedish: "sv", danish: "da", norwegian: "no", finnish: "fi", czech: "cs",
  hungarian: "hu", greek: "el", hebrew: "he", thai: "th", vietnamese: "vi", indonesian: "id", malay: "ms", ukrainian: "uk", romanian: "ro", persian: "fa",
  multi: "multi", "dual audio": "multi", "multi audio": "multi",
};

export function languageCodes(names: string[]): string[] {
  return [...new Set(names.map((n) => LANGUAGE_NAMES[n.trim().toLowerCase()]).filter((c): c is string => !!c))];
}

/** Flags of the languages Torrentio-style titles show (it shows them for non-English audio). */
const FLAG_LANGUAGES: Record<string, string> = {
  "🇬🇧": "en", "🇺🇸": "en", "🇯🇵": "ja", "🇨🇳": "zh", "🇹🇼": "zh", "🇰🇷": "ko", "🇫🇷": "fr", "🇩🇪": "de", "🇪🇸": "es", "🇲🇽": "es", "🇮🇹": "it", "🇵🇹": "pt", "🇧🇷": "pt",
  "🇷🇺": "ru", "🇮🇳": "hi", "🇸🇦": "ar", "🇹🇷": "tr", "🇳🇱": "nl", "🇵🇱": "pl", "🇸🇪": "sv", "🇩🇰": "da", "🇳🇴": "no", "🇫🇮": "fi", "🇨🇿": "cs", "🇭🇺": "hu",
  "🇬🇷": "el", "🇮🇱": "he", "🇹🇭": "th", "🇻🇳": "vi", "🇮🇩": "id", "🇺🇦": "uk", "🇷🇴": "ro", "🇮🇷": "fa",
};

/** Languages a stream's text shows: flags, and "Multi Audio" / "Dual Audio". */
export function languagesFromText(text: string): string[] {
  const codes = new Set<string>();
  // "MULTi" in scene names is several audio tracks; "Multi-Subs" isn't.
  if (/\b(multi|dual)[\s-]?audio\b|\bmulti\b(?![\s.-]?subs?\b)/i.test(text)) codes.add("multi");
  for (const [flag, code] of Object.entries(FLAG_LANGUAGES)) if (text.includes(flag)) codes.add(code);
  return [...codes];
}
