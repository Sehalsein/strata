// Mirrors the server's response shapes (apps/server/src/api/routes/*).

export interface ServerInfo {
  name: string;
  serverName: string;
  version: string;
  apiVersion: number | string;
  setupRequired: boolean;
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
}

export type SecretKey = "tmdbApiKey" | "torboxApiKey";

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

export interface Profile {
  id: number;
  name: string;
  avatar: string | null;
  hasPin: boolean;
}

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
  profileId: number;
  profileName: string | null;
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
  dataDir: string;
  uptimeMs: number;
  ffmpeg: { version: string; path: string; hwEncoder: string | null } | null;
  tmdb: { configured: boolean };
  torbox: { configured: boolean };
  jobs: JobStatus[];
  sessions: PlaybackSessionDto[];
  library: LibraryStats;
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

export interface LibraryFile {
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
