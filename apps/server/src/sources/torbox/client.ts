const BASE = "https://api.torbox.app/v1/api";

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
  files?: TorboxFile[];
}

export interface TorboxUser {
  email?: string;
  plan?: number;
  premium_expires_at?: string;
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
    return (await this.call<TorboxItem[] | null>(`/${kind}/mylist`, { bypass_cache: "true" })) ?? [];
  }

  /** A short-lived direct download URL for one file. */
  requestLink(kind: TorboxKind, itemId: number, fileId: number) {
    return this.call<string>(`/${kind}/requestdl`, { token: this.apiKey, [ID_PARAM[kind]]: String(itemId), file_id: String(fileId), zip_link: "false" });
  }

  private async call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
    });
    let body: { success?: boolean; error?: string | null; detail?: string; data?: T } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON error pages fall through to the status check.
    }
    if (!res.ok || body.success === false) {
      throw new TorboxError(`TorBox ${path}: ${body.detail ?? body.error ?? res.statusText}`, res.status === 401 || res.status === 403 ? 401 : 502);
    }
    return body.data as T;
  }
}
