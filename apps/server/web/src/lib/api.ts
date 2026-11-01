import type {
  AnilistResult,
  AdminStatus,
  FsListing,
  LibraryFile,
  LibraryFilters,
  LogEntry,
  SecretKey,
  ServerInfo,
  Settings,
  SettingsResponse,
  TmdbResult,
  TorboxAccount,
  UpdateStatus,
  ContentLimit,
  HouseholdDevice,
  SignInCode,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * How requests authenticate. Owned by lib/auth-client.ts (the only module that knows about
 * sessions): the dashboard's sessions are same-origin cookies, so it adds no headers and only
 * hears about 401s.
 */
export interface ApiAuth {
  /** Headers for an authenticated request (e.g. a bearer token); {} for cookie sessions. */
  headers(): Record<string, string>;
  /** Called once when an authenticated request comes back 401. */
  onUnauthorized(): void;
}
let auth: ApiAuth = { headers: () => ({}), onUnauthorized: () => {} };
export function configureApiAuth(next: ApiAuth) {
  auth = next;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.auth !== false) Object.assign(headers, auth.headers());
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the server", 0);
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = data as { error?: string; issues?: { path?: (string | number)[]; message?: string }[] } | null;
    let message = err?.error ?? `Request failed (${res.status})`;
    const issue = err?.issues?.[0];
    if (issue?.message) message = `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`;
    if (res.status === 401 && opts.auth !== false) auth.onUnauthorized();
    throw new ApiError(message, res.status);
  }
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  info: () => request<ServerInfo>("GET", "/info", undefined, { auth: false }),

  /** A member's name, kids flag and content limit in the active household (its admins). */
  updateMember: (memberId: string, patch: { name?: string; contentLimit?: ContentLimit; isKids?: boolean }) =>
    request<{ id: string; name?: string; contentLimit: ContentLimit; isKids: boolean }>("PATCH", `/household/members/${encodeURIComponent(memberId)}`, patch),

  /** Whose accounts the signed-in person may manage in the active household (reset, data, delete). */
  manageable: () => request<{ userIds: string[] }>("GET", "/household/manageable"),

  /** A member's sign-in QR code (works once, for a minute; ask again every 30 seconds). */
  signInCode: (memberId: string) =>
    request<SignInCode>("POST", `/household/members/${encodeURIComponent(memberId)}/sign-in-code`),

  status: () => request<AdminStatus>("GET", "/admin/status"),
  settings: () => request<SettingsResponse>("GET", "/admin/settings"),
  updateSettings: (patch: Partial<Settings>) => request<{ settings: Settings }>("PATCH", "/admin/settings", patch),
  setSecret: (key: SecretKey, value: string | null) => request<{ ok: true }>("PUT", `/admin/secrets/${key}`, { value }),
  torboxAccount: () => request<TorboxAccount>("GET", "/admin/torbox/account"),
  fs: (path?: string) => request<FsListing>("GET", `/admin/fs${q({ path })}`),
  runJob: (name: string) => request<{ ok: true }>("POST", `/admin/jobs/${encodeURIComponent(name)}/run`),

  files: (params: LibraryFilters) =>
    request<{ items: LibraryFile[]; total: number }>("GET", `/admin/files${q({ ...params })}`),
  /** By the title's ref (AniList titles; an AniList show's season is 1), or TMDB's id and type. */
  matchFile: (fileId: number, input: { ref: string; season?: number; episode?: number } | { type: "movie" | "show"; tmdbId: number; season?: number; episode?: number }) =>
    request<{ ok: true }>("POST", `/admin/files/${fileId}/match`, input),
  ignoreFile: (fileId: number) => request<{ ok: true }>("POST", `/admin/files/${fileId}/ignore`),
  unignoreFile: (fileId: number) => request<{ ok: true }>("POST", `/admin/files/${fileId}/unignore`),
  tmdbSearch: (query: string, type: "movie" | "show") => request<{ items: TmdbResult[] }>("GET", `/admin/tmdb/search${q({ q: query, type })}`),
  anilistSearch: (query: string) => request<{ items: AnilistResult[] }>("GET", `/admin/anilist/search${q({ q: query })}`),

  updateStatus: () => request<UpdateStatus>("GET", "/admin/update"),
  checkUpdate: () => request<UpdateStatus>("POST", "/admin/update/check"),
  applyUpdate: () => request<UpdateStatus>("POST", "/admin/update/apply"),

  /** Every device signed in to the household, with whose it is (its admins). */
  devices: () => request<{ items: HouseholdDevice[] }>("GET", "/admin/devices"),
  signOutDevice: (id: string) => request<{ ok: true }>("DELETE", `/admin/devices/${encodeURIComponent(id)}`),
  stopSession: (id: string) => request<{ ok: true }>("DELETE", `/admin/sessions/${encodeURIComponent(id)}`),
  logs: (limit = 500) => request<{ items: LogEntry[] }>("GET", `/admin/logs${q({ limit })}`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Where the privacy page is: the public site in front of the server when there is one, else this one. */
export function privacyUrl(info: { siteUrl?: string | null } | undefined): string {
  return info?.siteUrl ? `${info.siteUrl.replace(/\/+$/, "")}/privacy` : "/privacy";
}
