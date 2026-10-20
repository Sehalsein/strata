const BASE = "https://api.torbox.app/v1/api";
const SEARCH_BASE = "https://search-api.torbox.app";
const PAGE = 1000;

export type TorboxKind = "torrents" | "usenet" | "webdl";

export interface TorboxFile {
  id: number;
  name: string;
  short_name?: string;
  size: number;
  mimetype?: string;
}

export interface TorboxItem {
  id: number;
  hash?: string;
  name: string;
  size: number;
  download_finished?: boolean;
  download_present?: boolean;
  download_state?: string;
  /** 0–1 */
  progress?: number;
  download_speed?: number;
  /** Seconds remaining. */
  eta?: number;
  files?: TorboxFile[];
}

export interface TorboxUser {
  email?: string;
  plan?: number;
  premium_expires_at?: string;
}

export interface TorboxCachedEntry {
  name: string;
  size: number;
  hash: string;
  files?: { name: string; size: number }[];
}

/** One release from TorBox's search API (search-api.torbox.app). */
export interface TorboxSearchTorrent {
  hash: string;
  raw_title: string;
  title?: string;
  magnet?: string;
  size: number;
  last_known_seeders?: number;
  tracker?: string;
  cached?: boolean;
  owned?: boolean;
}

export class TorboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const ID_PARAM: Record<TorboxKind, string> = { torrents: "torrent_id", usenet: "usenet_id", webdl: "web_id" };

export class TorboxClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  me() {
    return this.call<TorboxUser>("/user/me");
  }

  async list(kind: TorboxKind): Promise<TorboxItem[]> {
    const all: TorboxItem[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = (await this.call<TorboxItem[] | null>(`/${kind}/mylist`, { bypass_cache: "true", limit: String(PAGE), offset: String(offset) })) ?? [];
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  }

  torrent(id: number) {
    return this.call<TorboxItem>("/torrents/mylist", { bypass_cache: "true", id: String(id) });
  }

  /** Which of `hashes` TorBox already has cached (lowercased hash → entry). */
  async checkCached(hashes: string[]): Promise<Map<string, TorboxCachedEntry>> {
    const found = new Map<string, TorboxCachedEntry>();
    for (let i = 0; i < hashes.length; i += 100) {
      const data = await this.call<Record<string, TorboxCachedEntry> | TorboxCachedEntry[] | null>(
        "/torrents/checkcached",
        { format: "object", list_files: "true" },
        { method: "POST", body: JSON.stringify({ hashes: hashes.slice(i, i + 100) }), headers: { "Content-Type": "application/json" } },
      );
      // `format=object` isn't guaranteed; accept an array too.
      for (const entry of Array.isArray(data) ? data : Object.values(data ?? {})) {
        if (entry?.hash) found.set(entry.hash.toLowerCase(), entry);
      }
    }
    return found;
  }

  /** Adds a torrent to the account. Cached torrents are ready immediately. */
  async createTorrent(magnet: string, name?: string): Promise<{ torrentId: number; hash?: string }> {
    const form = new FormData();
    form.append("magnet", magnet);
    form.append("allow_zip", "false");
    if (name) form.append("name", name);
    const data = await this.call<{ torrent_id: number; hash?: string }>("/torrents/createtorrent", {}, { method: "POST", body: form });
    return { torrentId: data.torrent_id, hash: data.hash };
  }

  /** Releases for an IMDb id from TorBox's search API, with cache/ownership flags. */
  async search(imdbId: string, season?: number, episode?: number): Promise<TorboxSearchTorrent[]> {
    const params = new URLSearchParams({ check_cache: "true", check_owned: "true" });
    if (season !== undefined) params.set("season", String(season));
    if (episode !== undefined) params.set("episode", String(episode));
    const res = await this.fetchImpl(`${SEARCH_BASE}/torrents/imdb:${imdbId}?${params}`, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" } });
    if (!res.ok) throw new TorboxError(`TorBox search: ${res.status}`, 502);
    const body = (await res.json()) as { data?: { torrents?: TorboxSearchTorrent[] } };
    return body.data?.torrents ?? [];
  }

  /** Removes a torrent from the account. */
  async deleteTorrent(torrentId: number): Promise<void> {
    await this.call("/torrents/controltorrent", {}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ torrent_id: torrentId, operation: "delete" }),
    });
  }

  /** A short-lived direct download URL for one file. */
  requestLink(kind: TorboxKind, itemId: number, fileId: number) {
    return this.call<string>(`/${kind}/requestdl`, { token: this.apiKey, [ID_PARAM[kind]]: String(itemId), file_id: String(fileId), zip_link: "false" });
  }

  private async call<T>(path: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}?${new URLSearchParams(params)}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    let body: { success?: boolean; error?: string | null; detail?: string; data?: T } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON error pages fall through to the status check.
    }
    if (!res.ok || body.success === false) {
      const status = res.status === 401 || res.status === 403 ? 401 : res.status === 404 ? 404 : 502;
      throw new TorboxError(`TorBox ${path}: ${body.detail ?? body.error ?? res.statusText}`, status);
    }
    return body.data as T;
  }
}
