import { bigint, boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { TitleSource } from "../catalog/ref";

// Postgres: bundled (PGlite) on a home server, Neon or any Postgres in the cloud. Keep in
// lockstep with migrations.ts — the SQL there is the source of truth for the shape on
// disk; this file gives queries their types.
//
// Two kinds of tables:
// - Better Auth's (accounts, sign-in, households): `user` … `rateLimit`, as its
//   username, admin, organization, bearer and device-authorization plugins need them.
// - Strata's. A household (`organization`) owns its library, TorBox records, plays
//   and settings; progress and lists belong to each person's account; `api_cache` and
//   the server `settings` are shared by every household.

/** Milliseconds since 1970. Kept as bigint (int4 runs out in 1970 + 25 days). */
const ms = (name: string) => bigint(name, { mode: "number" });
const now = () => Date.now();
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// MARK: - Better Auth

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Invitations go to it; nothing here sends mail (yet). */
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: at("created_at").notNull(),
  updatedAt: at("updated_at").notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  /** "admin" runs the server (its keys and households); everyone else is "user". */
  role: text("role"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: at("ban_expires"),
  /** Signed in with a temporary password from an admin: a new one is needed first. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: at("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    /** The household this device is in. */
    activeOrganizationId: text("active_organization_id"),
    /** Joined without a password (home network) or a TV: can watch, never administer. */
    viewerOnly: boolean("viewer_only").default(false),
    /** Where the device was last seen ("Home network", or a city from Cloudflare). */
    location: text("location"),
    /** The device's own name and model, as the Strata apps send them. */
    deviceName: text("device_name"),
    deviceModel: text("device_model"),
  },
  (t) => [index("session_user_id").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: at("access_token_expires_at"),
    refreshTokenExpiresAt: at("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("account_user").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);

/** A household. */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: at("created_at").notNull(),
  metadata: text("metadata"),
});

/**
 * A person in a household: "owner", "admin" (runs it) or "member" (watches). Each person
 * signs in with their own account — that's their profile: their progress and lists
 * follow the account, and a device keeps several sign-ins to switch between.
 */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: at("created_at").notNull(),
    /** "none" | "teen" | "kids" | "little" (see catalog/contentRating.ts), set by the household's admins. */
    contentLimit: text("content_limit").notNull().default("none"),
    /** Shown as a kids' account in the apps. */
    isKids: boolean("is_kids").notNull().default(false),
  },
  (t) => [index("member_organization").on(t.organizationId), index("member_user").on(t.userId)],
);

/**
 * Invitations to a household (Better Auth's). Nothing here sends mail: the dashboard
 * shows the link to pass on. Signing up needs a pending invitation for that email.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("invitation_organization").on(t.organizationId), index("invitation_email").on(t.email)],
);

/** TV sign-in (RFC 8628 device authorization). */
export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  userId: text("user_id"),
  expiresAt: at("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: at("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

/** Passkeys (WebAuthn), when the server has a public HTTPS address. */
export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: at("created_at"),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id").on(t.userId), index("passkey_credential_id").on(t.credentialID)],
);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: ms("last_request").notNull(),
});

// MARK: - Strata: the server

/** Server-wide settings (and the TMDB/OMDb keys, sealed). Households have their own. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Answers from outside services (TMDB, OMDb, AniList, Kitsu…), shared by every household. */
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  json: text("json").notNull(),
  fetchedAt: ms("fetched_at").notNull(),
});

/** Failed setup codes and password-less starts per key (Better Auth limits sign-in itself). */
export const authAttempts = pgTable("auth_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: ms("window_start").notNull(),
  lockedUntil: ms("locked_until"),
});

// MARK: - Strata: a household's

/** Household settings (and its TorBox key, sealed). */
export const householdSettings = pgTable(
  "household_settings",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export type FileProvider = "local" | "torbox";
export type MatchStatus = "pending" | "matched" | "unmatched" | "manual" | "ignored";

export const files = pgTable(
  "files",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").$type<FileProvider>().notNull(),
    /** Local: absolute path. TorBox: "<kind>:<itemId>:<fileId>". */
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    mtime: ms("mtime"),
    parsedJson: text("parsed_json"),
    probeJson: text("probe_json"),
    mediaType: text("media_type").$type<"movie" | "episode">(),
    source: text("source").$type<TitleSource>().notNull().default("tmdb"),
    /** The movie's or show's id at `source`. */
    titleId: integer("title_id"),
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
    uniqueIndex("files_provider_ref").on(t.organizationId, t.provider, t.ref),
    index("files_title").on(t.organizationId, t.source, t.mediaType, t.titleId, t.season, t.episode),
    index("files_source_hash").on(t.organizationId, t.sourceHash),
  ],
);

/** TorBox torrents Strata added itself (discovery); only these are ever cleaned up. */
export const torboxAdded = pgTable(
  "torbox_added",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    torrentId: bigint("torrent_id", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
    name: text("name"),
    addedAt: ms("added_at").notNull().$defaultFn(now),
    lastPlayedAt: ms("last_played_at"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.torrentId] })],
);

/** One row per movie/show that has at least one matched file. Powers library shelves. */
export const mediaItems = pgTable(
  "media_items",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    source: text("source").$type<TitleSource>().notNull().default("tmdb"),
    titleId: integer("title_id").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    addedAt: ms("added_at").notNull().$defaultFn(now),
    /** JSON array of TMDB genre ids, recorded when a file is matched (null for older rows). */
    genreIds: text("genre_ids"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.source, t.type, t.titleId] })],
);

export const progress = pgTable(
  "progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaType: text("media_type").$type<"movie" | "episode">().notNull(),
    source: text("source").$type<TitleSource>().notNull().default("tmdb"),
    /** Movie id, or the show id for episodes, at `source`. */
    titleId: integer("title_id").notNull(),
    season: integer("season").notNull().default(0),
    episode: integer("episode").notNull().default(0),
    positionMs: integer("position_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    completed: boolean("completed").notNull().default(false),
    updatedAt: ms("updated_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source, t.mediaType, t.titleId, t.season, t.episode] })],
);

/** Titles taken off Continue Watching / Next Up; they come back when watched again. */
export const continueHidden = pgTable(
  "continue_hidden",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    source: text("source").$type<TitleSource>().notNull().default("tmdb"),
    titleId: integer("title_id").notNull(),
    hiddenAt: ms("hidden_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source, t.type, t.titleId] })],
);

export const watchlist = pgTable(
  "watchlist",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<"movie" | "show">().notNull(),
    source: text("source").$type<TitleSource>().notNull().default("tmdb"),
    titleId: integer("title_id").notNull(),
    addedAt: ms("added_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source, t.type, t.titleId] })],
);

/**
 * Plays of TorBox files: the server only handed the app a link, so any server sharing
 * the database can refresh it, record progress against it or end it. (Local files,
 * streamed by this server's ffmpeg, keep their sessions in memory.)
 */
export const playSessions = pgTable(
  "play_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileId: integer("file_id").notNull(),
    /** { source, mediaType, titleId, season?, episode? }; older rows: { mediaType, tmdbId, … } (TMDB). */
    targetJson: text("target_json").notNull(),
    /** The playback plan (mode, audio, reasons…). */
    planJson: text("plan_json").notNull(),
    /** The TorBox link handed out. */
    input: text("input").notNull(),
    createdAt: ms("created_at").notNull(),
    lastAccessAt: ms("last_access_at").notNull(),
  },
  (t) => [index("play_sessions_organization").on(t.organizationId)],
);
