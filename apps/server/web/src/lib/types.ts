// Mirrors the server's response shapes (apps/server/src/api/routes/*).

export interface ServerInfo {
  name: string;
  serverName: string;
  /** Stable per-install id. */
  id: string;
  version: string;
  apiVersion: number | string;
  setupRequired: boolean;
  /** True when POST /setup/admin needs the code printed in the server log (not opened from the server itself). */
  setupCodeRequired?: boolean;
  /** True when this client may join without a password. */
  localJoin?: boolean;
  /** "cloud": hosted, without local folders, home-network join, Bonjour or self-update. */
  mode: "home" | "cloud";
  /** Ways in besides a password that this server is set up for. */
  signIn?: { google: boolean; passkey: boolean; passwordReset?: boolean };
}

/** A passkey saved for the signed-in account. */
export interface SavedPasskey {
  id: string;
  name?: string | null;
  createdAt: string;
  deviceType: string;
}

export type HouseholdRole = "owner" | "admin" | "member";

/** GET /api/me: the signed-in account and its active household on this browser. */
export interface Me {
  user: { id: string; username: string | null; name: string; email: string; isServerAdmin: boolean };
  /** Joined without a password, or a TV: can watch, never administer. */
  viewerOnly: boolean;
  /** Signed in with a temporary password from an admin: a new one is needed first. */
  mustChangePassword?: boolean;
  household: { id: string; name: string; role: string; contentLimit: ContentLimit; isKids: boolean } | null;
}

/** A household (Better Auth organization) as listed. */
export interface HouseholdSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: string;
  contentLimit?: ContentLimit;
  isKids?: boolean;
  user: { id: string; name: string; email: string; image?: string | null };
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
  createdAt?: string;
  inviterId: string;
}

export interface FullHousehold extends HouseholdSummary {
  members: Member[];
  invitations: Invitation[];
}

/** A sign-in of the current account (Better Auth session). */
export interface AuthSession {
  id: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  activeOrganizationId: string | null;
  /** A TV or a home-network join: can watch, never administer. */
  viewerOnly?: boolean | null;
  location?: string | null;
  deviceName?: string | null;
  deviceModel?: string | null;
}

/** POST /api/household/members/:id/sign-in-code: what a member's QR code holds. */
export interface SignInCode {
  name: string;
  server: string;
  expiresAt: string;
  refreshInSeconds: number;
  /** strata://sign-in?server=…&code=… */
  link: string;
}

/** GET /api/admin/devices: a device signed in to the household, and whose it is. */
export interface HouseholdDevice {
  id: string;
  userId: string;
  userName: string;
  username: string | null;
  userAgent: string | null;
  /** The address it last used. */
  ipAddress: string | null;
  /** "Home network", or a city from Cloudflare; null when unknown. */
  location: string | null;
  /** The device's own name and model ("Living Room", "AppleTV14,1"), from the Strata apps. */
  deviceName: string | null;
  deviceModel: string | null;
  /** Only for devices on a home server's own network. */
  macAddress: string | null;
  /** A made-up address (iPhones and iPads use a different one per network). */
  macIsPrivate: boolean;
  viewerOnly: boolean;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

/** An account signed in on this browser (multi-session). */
export interface DeviceAccount {
  session: AuthSession;
  user: { id: string; name: string; email: string; username?: string | null; role?: string | null };
}

/** GET /api/auth/device: a TV's code. */
export interface DeviceCodeInfo {
  user_code: string;
  status: "pending" | "approved" | "denied";
  client_id?: string;
}

export type MediaFolderKind = "auto" | "movies" | "shows";
export interface MediaFolder {
  path: string;
  kind: MediaFolderKind;
}

export type Provider = "local" | "torbox";

export interface Settings {
  serverName: string;
  mediaFolders: MediaFolder[];
  language: string;
  region: string;
  scanIntervalMinutes: number;
  torboxSyncMinutes: number;
  sourcePriority: Provider[];
  maxResolution: number;
  hardwareAcceleration: boolean;
  maxTranscodes: number;
  discoveryEnabled: boolean;
  torrentioUrl: string;
  useTorboxSearch: boolean;
  showUncached: boolean;
  maxReleaseSizeGb: number;
  bonjourEnabled: boolean;
  localJoin: boolean;
  torboxCleanupDays: number;
  updateChannel: UpdateChannel;
  autoUpdate: boolean;
  updateManifestUrl: string;
}

export type UpdateChannel = "stable" | "nightly";
export type UpdateState = "idle" | "checking" | "available" | "downloading" | "waiting-for-idle" | "restarting" | "error";

export interface UpdateStatus {
  currentVersion: string;
  platform: string;
  channel: UpdateChannel;
  autoUpdate: boolean;
  state: UpdateState;
  disabledReason: string | null;
  /** The manifest being polled; null when the build has no feed and no override is set. */
  manifestUrl: string | null;
  latest: { version: string; publishedAt: string; minClientApi: number; notes: string | null; size: number | null } | null;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  progress: { received: number; total: number } | null;
  lastUpdate: { result: "ok" | "rolled-back"; fromVersion: string; toVersion: string; at: string; message?: string } | null;
}

export type SecretKey = "tmdbApiKey" | "torboxApiKey" | "omdbApiKey";

export interface SettingsResponse {
  settings: Settings;
  secrets: Record<SecretKey, boolean>;
}

export interface FsListing {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  shortcuts: { name: string; path: string }[];
}

export type ContentLimit = "none" | "teen" | "kids" | "little";

export interface JobStatus {
  name: string;
  running: boolean;
  progress?: { done: number; total: number; label?: string };
  lastRunAt?: number;
  lastDurationMs?: number;
  lastError?: string;
  lastResult?: unknown;
  nextRunAt?: number;
}

export interface PlaybackSessionDto {
  id: string;
  userId: string;
  userName: string | null;
  fileId: number;
  title: string | null;
  target: { mediaType: "movie" | "episode"; tmdbId: number; season?: number; episode?: number };
  mode: "direct" | "remux" | "transcode";
  reasons: string[];
  source: Provider;
  startedAt: number;
  lastAccessAt: number;
  paused: boolean;
  error: string | null;
}

export type MatchStatus = "pending" | "matched" | "unmatched" | "manual" | "ignored";

export interface LibraryStats {
  files: { provider: Provider; status: MatchStatus; count: number }[];
  titles: Partial<Record<"movie" | "show", number>>;
}

export interface AdminStatus {
  version: string;
  apiVersion: number | string;
  platform: string;
  mode: "home" | "cloud";
  isServerAdmin: boolean;
  /** Null on the cloud server. */
  dataDir: string | null;
  uptimeMs: number;
  ffmpeg: { version: string; path: string; hwEncoder: string | null } | null;
  ffmpegSetup?: { state: "idle" | "downloading" | "unsupported" } | { state: "failed"; error: string };
  tmdb: { configured: boolean };
  torbox: { configured: boolean };
  jobs: JobStatus[];
  sessions: PlaybackSessionDto[];
  library: LibraryStats;
  network: { host: string; port: number; urls: string[]; bonjour: boolean };
  update: { state: UpdateState; updateAvailable: boolean; latestVersion: string | null; lastError: string | null };
}

export interface TorboxAccount {
  email: string | null;
  plan: number | string | null;
  premiumExpiresAt: string | null;
}

export interface ParsedName {
  kind: "movie" | "episode";
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: number;
  source?: string;
  videoCodec?: string;
  hdr?: string;
  group?: string;
}

export type LibrarySort = "lastAccessed" | "added" | "title" | "name" | "size" | "year";
export interface LibraryFilters {
  status?: MatchStatus; provider?: Provider; q?: string; searchIn?: "all" | "title" | "filename";
  mediaType?: "movie" | "episode"; accessed?: "yes" | "no"; sort?: LibrarySort; direction?: "asc" | "desc";
  limit?: number; offset?: number;
}

export interface LibraryFile {
  lastAccessedAt: number | null;
  addedAt: number;
  id: string;
  fileId: number;
  provider: Provider;
  name: string;
  size: number;
  resolution?: number;
  source?: string;
  videoCodec?: string;
  hdr?: string | null;
  audio?: { codec: string; channels: number; language?: string }[];
  durationMs?: number;
  probed: boolean;
  ref?: string;
  matchStatus: MatchStatus;
  mediaType: "movie" | "episode" | null;
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  /** Matched title, when the file is matched. */
  title: string | null;
  year: number | null;
  parsed: ParsedName | null;
}

export interface TmdbResult {
  tmdbId: number;
  title: string;
  year?: number | null;
  posterUrl: string | null;
}

export interface LogEntry {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
}

