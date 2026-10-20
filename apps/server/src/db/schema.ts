import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// Keep in lockstep with migrations.ts — the SQL there is the source of truth for the
// on-disk shape; this file gives queries their types.

const now = sql`(unixepoch() * 1000)`;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().default(now),
});

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  avatar: text("avatar"),
  pinHash: text("pin_hash"),
  createdAt: integer("created_at").notNull().default(now),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  profileId: integer("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  deviceName: text("device_name"),
  createdAt: integer("created_at").notNull().default(now),
  lastSeenAt: integer("last_seen_at").notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const tmdbCache = sqliteTable("tmdb_cache", {
  key: text("key").primaryKey(),
  json: text("json").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export type FileProvider = "local" | "torbox";
export type MatchStatus = "pending" | "matched" | "unmatched" | "manual" | "ignored";

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").$type<FileProvider>().notNull(),
    /** Local: absolute path. TorBox: "<kind>:<itemId>:<fileId>". */
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    mtime: integer("mtime"),
    parsedJson: text("parsed_json"),
    probeJson: text("probe_json"),
    mediaType: text("media_type").$type<"movie" | "episode">(),
    tmdbId: integer("tmdb_id"),
    season: integer("season"),
    episode: integer("episode"),
    matchStatus: text("match_status").$type<MatchStatus>().notNull().default("pending"),
    missing: integer("missing", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("files_provider_ref").on(t.provider, t.ref),
    index("files_tmdb").on(t.mediaType, t.tmdbId, t.season, t.episode),
  ],
);

/** One row per movie/show that has at least one matched file. Powers library shelves. */
export const mediaItems = sqliteTable(
  "media_items",
  {
    type: text("type").$type<"movie" | "show">().notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.type, t.tmdbId] })],
);

export const progress = sqliteTable(
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
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.mediaType, t.tmdbId, t.season, t.episode] })],
);

export const watchlist = sqliteTable(
  "watchlist",
  {
    profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.type, t.tmdbId] })],
);
