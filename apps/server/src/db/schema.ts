import { bigint, boolean, index, integer, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

// Postgres: bundled (PGlite) on a home server, Neon or any Postgres in the cloud. Keep in
// lockstep with migrations.ts — the SQL there is the source of truth for the shape on
// disk; this file gives queries their types.

/** Milliseconds since 1970. Kept as bigint (int4 runs out in 1970 + 25 days). */
const ms = (name: string) => bigint(name, { mode: "number" });
const now = () => Date.now();

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: ms("created_at").notNull().$defaultFn(now),
});

export const profiles = pgTable("profiles", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  pinHash: text("pin_hash"),
  createdAt: ms("created_at").notNull().$defaultFn(now),
  /** "none" | "teen" | "kids" | "little" (see catalog/contentRating.ts). */
  contentLimit: text("content_limit").notNull().default("none"),
  /** A Kids profile: starts with the "kids" limit and is marked in the apps. */
  isKids: boolean("is_kids").notNull().default(false),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  deviceName: text("device_name"),
  createdAt: ms("created_at").notNull().$defaultFn(now),
  lastSeenAt: ms("last_seen_at").notNull().$defaultFn(now),
  /** Joined without a password (home network, TV code): can watch, never administer. */
  viewerOnly: boolean("viewer_only").notNull().default(false),
  /** Slides forward with use; a device unused this long is signed out. */
  expiresAt: ms("expires_at").notNull(),
});

/** Failed sign-in, PIN and join attempts per key ("login:user:alice", "pin:<session>"…). */
export const authAttempts = pgTable("auth_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: ms("window_start").notNull(),
  lockedUntil: ms("locked_until"),
});

/**
 * TV sign-in by code (see deviceLink.ts). Kept here rather than in memory so a restart,
 * or another server behind the same address, doesn't lose a sign-in in progress.
 */
export const deviceLinks = pgTable("device_links", {
  code: text("code").primaryKey(),
  /** SHA-256 of the TV's secret poll token. */
  pollHash: text("poll_hash").notNull().unique(),
  deviceName: text("device_name").notNull(),
  expiresAt: ms("expires_at").notNull(),
  lastSeenAt: ms("last_seen_at").notNull(),
  /** The approved session's token, sealed, until the TV picks it up. */
  sealedToken: text("sealed_token"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Answers from outside services (TMDB, OMDb, AniList, Kitsu…), shared by every server. */
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  json: text("json").notNull(),
  fetchedAt: ms("fetched_at").notNull(),
});

export type FileProvider = "local" | "torbox";
export type MatchStatus = "pending" | "matched" | "unmatched" | "manual" | "ignored";

export const files = pgTable(
  "files",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    provider: text("provider").$type<FileProvider>().notNull(),
    /** Local: absolute path. TorBox: "<kind>:<itemId>:<fileId>". */
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    mtime: ms("mtime"),
    parsedJson: text("parsed_json"),
    probeJson: text("probe_json"),
    mediaType: text("media_type").$type<"movie" | "episode">(),
    tmdbId: integer("tmdb_id"),
    season: integer("season"),
    episode: integer("episode"),
    matchStatus: text("match_status").$type<MatchStatus>().notNull().default("pending"),
    /** Torrent info-hash (lowercase) for TorBox torrent files. */
    sourceHash: text("source_hash"),
    missing: boolean("missing").notNull().default(false),
    addedAt: ms("added_at").notNull().$defaultFn(now),
    updatedAt: ms("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("files_provider_ref").on(t.provider, t.ref),
    index("files_tmdb").on(t.mediaType, t.tmdbId, t.season, t.episode),
    index("files_source_hash").on(t.sourceHash),
  ],
);

/** One row per movie/show that has at least one matched file. Powers library shelves. */
/** TorBox torrents Strata added itself (discovery); only these are ever cleaned up. */
export const torboxAdded = pgTable("torbox_added", {
  torrentId: bigint("torrent_id", { mode: "number" }).primaryKey(),
  hash: text("hash").notNull(),
  name: text("name"),
  addedAt: ms("added_at").notNull().$defaultFn(now),
  lastPlayedAt: ms("last_played_at"),
});

export const mediaItems = pgTable(
  "media_items",
  {
    type: text("type").$type<"movie" | "show">().notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    addedAt: ms("added_at").notNull().$defaultFn(now),
    /** JSON array of TMDB genre ids, recorded when a file is matched (null for older rows). */
    genreIds: text("genre_ids"),
  },
  (t) => [primaryKey({ columns: [t.type, t.tmdbId] })],
);

export const progress = pgTable(
  "progress",
  {
    profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    mediaType: text("media_type").$type<"movie" | "episode">().notNull(),
    /** Movie id, or the show id for episodes. */
    tmdbId: integer("tmdb_id").notNull(),
    season: integer("season").notNull().default(0),
    episode: integer("episode").notNull().default(0),
    positionMs: integer("position_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    completed: boolean("completed").notNull().default(false),
    updatedAt: ms("updated_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.mediaType, t.tmdbId, t.season, t.episode] })],
);

/** Titles taken off Continue Watching / Next Up; they come back when watched again. */
export const continueHidden = pgTable(
  "continue_hidden",
  {
    profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    hiddenAt: ms("hidden_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.type, t.tmdbId] })],
);

export const watchlist = pgTable(
  "watchlist",
  {
    profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    addedAt: ms("added_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.type, t.tmdbId] })],
);
