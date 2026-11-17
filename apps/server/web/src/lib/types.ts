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
  /** What this server does: ask these rather than `mode`. */
  capabilities: Capabilities;
  /** The public site in front of this server (the cloud's landing page), which has the privacy page. */
  siteUrl?: string | null;
  /** Ways in besides a password that this server is set up for. */
  signIn?: {
    google: boolean;
    passkey: boolean;
    /** The domain passkeys belong to ("localhost" on a home server without an HTTPS address). */
    passkeyDomain?: string | null;
    /** The one address passkeys work at (see features/auth/passkey-availability.ts). */
    passkeyAddress?: string | null;
    passwordReset?: boolean;
    /** Cloud: anyone may make an account (and gets a household of their own). */
    signUp?: boolean;
    /** New accounts confirm their email before signing in. */
    confirmEmail?: boolean;
  };
}

/** What a server does (src/profile.ts on the server). */
export interface Capabilities {
  /** Media folders on the server's disk, played through ffmpeg. */
  localMedia: boolean;
  /** Announces itself on the home network. */
  bonjour: boolean;
  /** Devices on the home network may join without a password. */
  homeNetworkJoin: boolean;
  /** Updates itself (otherwise it's updated by deploying it). */
  selfUpdate: boolean;
  /** Anyone may make an account. */
  openSignUp: boolean;
  /** First-run setup makes the server's admin. */
  firstRunSetup: boolean;
  /** The public demo: nothing may be changed. */
  readOnly: boolean;
}

/** What the signed-in device may do (src/auth/permissions.ts on the server). */
export interface Permissions {
  administerHousehold: boolean;
  administerServer: boolean;
  change: boolean;
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
  user: { id: string; username: string | null; name: string; email: string; image: string | null; isServerAdmin: boolean };
  /** Joined without a password, or a TV: can watch, never administer. */
  viewerOnly: boolean;
  /** Signed in with a temporary password from an admin: a new one is needed first. */
  mustChangePassword?: boolean;
  household: { id: string; name: string; role: string; contentLimit: ContentLimit; isKids: boolean } | null;
  /** Worked out by the server: the dashboard doesn't read roles itself. */
  permissions: Permissions;
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

/** GET /api/invitations/:id: an invitation, as whoever holds its link sees it. */
export interface InvitationInfo {
  email: string;
  /** The email already has an account on this server. */
  hasAccount: boolean;
  role: string;
  household: string;
  serverName: string;
  expiresAt: string;
  /** The server's address for devices (not this machine's localhost). */
  server: string;
  /** strata://invite?server=…&id=…: what the QR code holds (opens the app). */
  link: string;
  /** https://<server>/invite/<id>: the same, to pass on as text; the page opens the app. */
  page: string;
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

/** Where a file plays from: this server's disk, TorBox, or an add-on's link. */
export type Provider = "local" | "torbox" | "link";

export interface Settings {
  serverName: string;
  mediaFolders: MediaFolder[];
  language: string;
  region: string;
  scanIntervalMinutes: number;
  torboxSyncMinutes: number;
  maxResolution: number;
  hardwareAcceleration: boolean;
  maxTranscodes: number;
  discoveryEnabled: boolean;
  torrentioUrl: string;
  useTorboxSearch: boolean;
  showUncached: boolean;
  maxReleaseSizeGb: number;
  /** ISO 639-1 codes, most wanted first; empty means the household's language. */
  subtitleLanguages: string[];
  autoSubtitles: "forced" | "foreign" | "always";
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

/** A Stremio add-on the household finds releases or subtitles with (its URL stays on the server). */
export interface StreamAddon {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
  kind: "stremio" | "aiostreams";
  /** It has its own configure page (opened through /api/admin/addons/:id/configure). */
  configurable: boolean;
  /** What it's asked for. */
  resources: ("stream" | "subtitles" | "catalog")[];
  /** Its catalogs of titles, and whether each is a row on Home. */
  catalogs: { key: string; name: string; type: "movie" | "show"; home: boolean }[];
  /** It's asked for anime by Kitsu id too. */
  anime: boolean;
  /** The built-in Strata entry (always there; it can be moved or switched off, not edited or removed). */
  isDefault: boolean;
  builtIn: boolean;
  /** What a built-in add-on covers, in words. */
  description?: string;
  /** How it's doing, as the server last found it. */
  health: { state: "ok" | "failing" | "paused" | "unknown"; message?: string; at?: number; latencyMs?: number; pausedUntil?: number };
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

/** A play that failed or had to switch copies or file servers, as an app reported it. */
export interface PlayReport {
  id: number;
  at: number;
  outcome: "failed" | "recovered";
  message: string;
  title: string | null;
  ref: string;
  mediaType: "movie" | "episode";
  season: number | null;
  episode: number | null;
  userName: string | null;
  deviceName: string | null;
  deviceModel: string | null;
  appVersion: string | null;
  location: string | null;
  attempts: {
    fileId?: number;
    copy?: string;
    stage?: string;
    error?: string;
    servers?: { host: string; error: string }[];
  }[];
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
  /** Named like a fansub release ("[Group] Title - 12"). */
  anime?: boolean;
}

export type LibrarySort = "lastAccessed" | "added" | "title" | "name" | "size" | "year";
export interface LibraryFilters {
  status?: MatchStatus; provider?: Provider; q?: string; searchIn?: "all" | "title" | "filename";
  mediaType?: "movie" | "episode"; accessed?: "yes" | "no"; sort?: LibrarySort; direction?: "asc" | "desc";
  limit?: number; offset?: number;
}

/** A fresh link to a library file, for playing it in the dashboard. */
export interface PlayLink {
  url: string;
  /** The file server (TorBox's) the link points at; null for this server's own copy. */
  host: string | null;
  provider: Provider;
  name: string;
  size: number;
  /** What the file holds, once an app or the server has read it. */
  info: {
    container?: string;
    durationMs?: number;
    bitrate?: number;
    video?: { codec: string; profile?: string; width?: number; height?: number; bitDepth?: number; hdr?: string | null };
    audio: { codec: string; channels: number; language?: string }[];
  } | null;
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
  /** Where the matched title comes from: TMDB, or AniList for anime. */
  titleSource: TitleSource;
  /** The matched title ("anilist:show:154587"), or null. */
  titleRef: string | null;
  /** TMDB's id, for TMDB titles. */
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  /** Matched title, when the file is matched. */
  title: string | null;
  year: number | null;
  parsed: ParsedName | null;
}

export type TitleSource = "tmdb" | "anilist";

export interface AnilistResult {
  /** "anilist:show:154587" or "anilist:movie:21519". */
  ref: string;
  anilistId: number;
  title: string;
  year: number | null;
  /** AniList's format: TV, MOVIE, OVA, ONA… */
  format: string | null;
  posterUrl: string | null;
  episodes: number | null;
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


/** A page of the apps (Home, Movies, Shows, Anime) and the rows on it, in order. */
export type PageId = "home" | "movies" | "shows" | "anime";

export interface PageRow {
  id: string;
  title: string;
  /** Strata's own row, one made for each person (Continue Watching, Top picks…), or an add-on catalog. */
  source: "strata" | "personal" | "addon";
  /** The add-on's name, for an add-on catalog. */
  addon?: string;
  /** The page's carousel: always first. */
  hero?: boolean;
  defaultOn: boolean;
  on: boolean;
  /** The household's name for it, shown in place of `title`. */
  name?: string;
  /** Titles the row shows before "See all"; unset is 15. */
  count?: number;
}

export interface PageLayout {
  id: PageId;
  title: string;
  rows: PageRow[];
}
