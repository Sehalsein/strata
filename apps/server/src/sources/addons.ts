import { z } from "zod";
import { isVideoFile } from "../media/parse";
import { globalFetch } from "../net";

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
});
export type StreamAddon = z.infer<typeof streamAddonSchema>;
export const streamAddonListSchema = z.array(streamAddonSchema);

/** What a household searches with before it sets up its own list: the server's Torrentio. */
export function defaultAddons(torrentioUrl: string): StreamAddon[] {
  if (!torrentioUrl) return [];
  return [{ id: "default", url: manifestUrl(torrentioUrl), name: "Torrentio", enabled: true, idPrefixes: ["tt", "kitsu"], kind: "stremio", configurable: true }];
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

const manifestSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  resources: z.array(z.union([z.string(), z.object({ name: z.string(), types: z.array(z.string()).optional(), idPrefixes: z.array(z.string()).optional() })])).default([]),
  types: z.array(z.string()).default([]),
  idPrefixes: z.array(z.string()).optional(),
  behaviorHints: z.object({ configurable: z.boolean().optional() }).passthrough().optional(),
});

/** Reads an add-on's manifest and checks it can find streams for movies or shows. */
export async function inspectAddon(input: string, fetchImpl: typeof fetch = globalFetch): Promise<Omit<StreamAddon, "id" | "enabled">> {
  const url = manifestUrl(input);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AddonError("Couldn't reach that add-on.");
  }
  if (!res.ok) throw new AddonError(`That add-on answered ${res.status}. Check the address (and that it's set up, for ones that need it).`);
  const parsed = manifestSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AddonError("That address isn't a Stremio add-on manifest.");
  const m = parsed.data;
  const stream = m.resources.find((r) => (typeof r === "string" ? r : r.name) === "stream");
  if (!stream) throw new AddonError(`${m.name ?? "That add-on"} doesn't find streams, so it can't find releases.`);
  const types = (typeof stream === "object" && stream.types) || m.types;
  if (!types.some((t) => t === "movie" || t === "series")) throw new AddonError(`${m.name ?? "That add-on"} doesn't have movies or shows.`);
  const idPrefixes = (typeof stream === "object" && stream.idPrefixes) || m.idPrefixes || null;
  const aio = /aiostreams/i.test(`${m.id ?? ""} ${m.name ?? ""}`) && aioCredentials(url) !== null;
  return { url, name: (m.name ?? addonOrigin(url)).slice(0, 100), idPrefixes, kind: aio ? "aiostreams" : "stremio", configurable: !!m.behaviorHints?.configurable };
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
  const res = await fetchImpl(`${addonBase(addon.url)}/stream/${type}/${id}.json`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await res.json()) as { streams?: StremioStream[] };
  return (body.streams ?? []).flatMap((s) => {
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
  const res = await fetchImpl(`${creds.root}/api/v1/search?${params}`, {
    headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${creds.uuid}:${creds.password}`)}` },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`${addon.name} ${res.status}`);
  const body = (await res.json()) as { success?: boolean; data?: { results?: AioResult[] } | null; error?: { message?: string } | null };
  if (!body.success) throw new Error(`${addon.name}: ${body.error?.message ?? "search failed"}`);
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
