import { z } from "zod";
import { isVideoFile } from "../media/parse";
import { globalFetch } from "../net";
import { runtime } from "#runtime";

/**
 * A Stremio stream add-on a household searches for releases (Torrentio, AIOStreams, Comet,
 * MediaFusion…): anything that answers `/stream/{movie|series}/{id}.json`. Kept sealed,
 * since their URLs often carry a password or a debrid key.
 */
export const streamAddonSchema = z.object({
  id: z.string().min(1),
  /** The manifest URL, ending in /manifest.json. */
  url: z.string().url(),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  /** The ids it answers for ("tt", "kitsu"…), from its manifest; null when it doesn't say. */
  idPrefixes: z.array(z.string()).nullable().default(null),
  /** AIOStreams also has a search API that says what Stremio's streams leave out (hashes). */
  kind: z.enum(["stremio", "aiostreams"]).default("stremio"),
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

/** What a household searches with before it sets up its own list: the server's Torrentio. */
export function defaultAddons(torrentioUrl: string): StreamAddon[] {
  if (!torrentioUrl) return [];
  return [{ id: "default", url: manifestUrl(torrentioUrl), name: "Torrentio", enabled: true, idPrefixes: ["tt", "kitsu"], kind: "stremio", configurable: true, allowPrivate: true }];
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
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new Error("Add-on answer too large");
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
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
  return JSON.parse(new TextDecoder().decode(all));
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
  if (runtime.name !== "bun") return;
  let addresses: string[];
  try {
    const { lookup } = await import("node:dns/promises");
    addresses = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return; // doesn't resolve: the fetch fails on its own
  }
  if (addresses.some((a) => !isPublicAddress(a))) refuse();
}

function isIpLiteral(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(raw: string): boolean {
  let address = raw.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) address = mapped[1]!;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    return true;
  }
  if (address === "::" || address === "::1") return false;
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
  behaviorHints: z.object({ configurable: z.boolean().optional() }).passthrough().optional(),
});

/** Reads an add-on's manifest and checks it can find streams for movies or shows. */
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
  const stream = m.resources.find((r) => (typeof r === "string" ? r : r.name) === "stream");
  if (!stream) throw new AddonError(`${m.name ?? "That add-on"} doesn't find streams, so it can't find releases.`);
  const types = (typeof stream === "object" && stream.types) || m.types;
  if (!types.some((t) => t === "movie" || t === "series")) throw new AddonError(`${m.name ?? "That add-on"} doesn't have movies or shows.`);
  const idPrefixes = (typeof stream === "object" && stream.idPrefixes) || m.idPrefixes || null;
  const aio = /aiostreams/i.test(`${m.id ?? ""} ${m.name ?? ""}`) && aioCredentials(url) !== null;
  return { url, name: (m.name ?? addonOrigin(url)).slice(0, 100), idPrefixes, kind: aio ? "aiostreams" : "stremio", configurable: !!m.behaviorHints?.configurable, allowPrivate };
}

/** A stream an add-on found, as far as discovery cares: a torrent, with what's known about it. */
export interface AddonStream {
  hash: string;
  title: string;
  fileName?: string;
  size?: number;
  seeders?: number;
  resolution?: number;
}

/**
 * Streams for `id` (an IMDb id, "tt…:S:E", or "kitsu:…"). Streams without an info-hash
 * (plain web links, usenet) are dropped: discovery adds torrents to TorBox itself.
 */
export async function addonStreams(addon: StreamAddon, type: "movie" | "series", id: string, fetchImpl: typeof fetch = globalFetch): Promise<AddonStream[]> {
  if (addon.kind === "aiostreams") {
    const viaSearch = await aioSearch(addon, type, id, fetchImpl);
    if (viaSearch) return viaSearch;
  }
  const res = await addonFetch(`${addonBase(addon.url)}/stream/${type}/${id}.json`, addon.allowPrivate, fetchImpl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await readJson(res)) as { streams?: StremioStream[] } | null;
  return (body?.streams ?? []).flatMap((s) => {
    const hash = streamHash(s);
    if (!hash) return [];
    const lines = (s.title ?? s.description ?? "").split("\n");
    const hintName = s.behaviorHints?.filename ?? s.streamData?.filename ?? undefined;
    const title = s.streamData?.folderName || lines[0]?.trim() || hintName || "";
    const fileName = hintName ?? (lines[1] && isVideoFile(lines[1].trim()) ? lines[1].trim() : undefined);
    const meta = lines.join(" ");
    return [
      {
        hash,
        title,
        fileName,
        size: s.behaviorHints?.videoSize ?? s.streamData?.size ?? parseSize(meta),
        seeders: s.streamData?.torrent?.seeders ?? (Number(/👤\s*(\d+)/.exec(meta)?.[1] ?? 0) || undefined),
        resolution: resolutionFromName(s.name),
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
  behaviorHints?: { filename?: string; videoSize?: number; bingeGroup?: string };
  /** AIOStreams' structured copy, on instances that hand it out. */
  streamData?: {
    filename?: string;
    folderName?: string;
    size?: number;
    torrent?: { infoHash?: string; seeders?: number };
  };
}

/** The stream's info-hash: given, or in a debrid link (Torrentio's /resolve/torbox/<key>/<hash>/…). */
function streamHash(s: StremioStream): string | null {
  const given = (s.infoHash ?? s.streamData?.torrent?.infoHash)?.toLowerCase();
  if (given && isInfoHash(given)) return given;
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
  parsedFile?: { resolution?: string };
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
    const res = Number(/\d+/.exec(r.parsedFile?.resolution ?? "")?.[0]) || resolutionFromName(r.parsedFile?.resolution);
    return [
      {
        hash,
        title: r.folderName || r.filename || "",
        fileName: r.filename ?? undefined,
        size: r.size ?? r.folderSize ?? undefined,
        seeders: r.seeders ?? undefined,
        resolution: res === 4 ? 2160 : res || undefined,
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
