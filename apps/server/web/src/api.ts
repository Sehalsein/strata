import type {
  AdminStatus,
  FsListing,
  LibraryFile,
  LibraryFilters,
  LogEntry,
  Profile,
  SecretKey,
  ServerInfo,
  Settings,
  SettingsResponse,
  TmdbResult,
  TorboxAccount,
  UpdateStatus,
  Device,
  ContentLimit,
} from "./types";

const TOKEN_KEY = "strata.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
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
    if (res.status === 401 && opts.auth !== false) {
      setToken(null);
      onUnauthorized();
    }
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
  setupAdmin: (username: string, password: string) =>
    request<{ token: string }>("POST", "/setup/admin", { username, password, deviceName: "Dashboard" }, { auth: false }),
  login: (username: string, password: string) =>
    request<{ token: string }>("POST", "/auth/login", { username, password, deviceName: "Dashboard" }, { auth: false }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),

  profiles: () => request<Profile[]>("GET", "/profiles"),
  createProfile: (name: string, pin?: string, isKids = false) => request<Profile>("POST", "/profiles", { name, isKids, ...(pin ? { pin } : {}) }),
  updateProfile: (id: number, patch: { name?: string; pin?: string | null; isKids?: boolean; contentLimit?: ContentLimit }) => request<Profile>("PATCH", `/profiles/${id}`, patch),
  deleteProfile: (id: number) => request<{ ok: true }>("DELETE", `/profiles/${id}`),

  status: () => request<AdminStatus>("GET", "/admin/status"),
  settings: () => request<SettingsResponse>("GET", "/admin/settings"),
  updateSettings: (patch: Partial<Settings>) => request<{ settings: Settings }>("PATCH", "/admin/settings", patch),
  setSecret: (key: SecretKey, value: string | null) => request<{ ok: true }>("PUT", `/admin/secrets/${key}`, { value }),
  torboxAccount: () => request<TorboxAccount>("GET", "/admin/torbox/account"),
  fs: (path?: string) => request<FsListing>("GET", `/admin/fs${q({ path })}`),
  runJob: (name: string) => request<{ ok: true }>("POST", `/admin/jobs/${encodeURIComponent(name)}/run`),

  files: (params: LibraryFilters) =>
    request<{ items: LibraryFile[]; total: number }>("GET", `/admin/files${q({ ...params })}`),
  matchFile: (fileId: number, input: { type: "movie" | "show"; tmdbId: number; season?: number; episode?: number }) =>
    request<{ ok: true }>("POST", `/admin/files/${fileId}/match`, input),
  ignoreFile: (fileId: number) => request<{ ok: true }>("POST", `/admin/files/${fileId}/ignore`),
  unignoreFile: (fileId: number) => request<{ ok: true }>("POST", `/admin/files/${fileId}/unignore`),
  tmdbSearch: (query: string, type: "movie" | "show") => request<{ items: TmdbResult[] }>("GET", `/admin/tmdb/search${q({ q: query, type })}`),

  updateStatus: () => request<UpdateStatus>("GET", "/admin/update"),
  checkUpdate: () => request<UpdateStatus>("POST", "/admin/update/check"),
  applyUpdate: () => request<UpdateStatus>("POST", "/admin/update/apply"),

  stopSession: (id: string) => request<{ ok: true }>("DELETE", `/admin/sessions/${encodeURIComponent(id)}`),
  devices: () => request<{ items: Device[] }>("GET", "/admin/devices"),
  signOutDevice: (id: string) => request<{ ok: true }>("DELETE", `/admin/devices/${encodeURIComponent(id)}`),
  logs: (limit = 500) => request<{ items: LogEntry[] }>("GET", `/admin/logs${q({ limit })}`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
