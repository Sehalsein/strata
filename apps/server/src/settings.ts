import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db";
import { householdSettings as householdTable, settings as serverTable } from "./db/schema";
import type { SecretBox } from "./secrets";
import { BUILD_CHANNEL } from "./version";

export const mediaFolderSchema = z.object({
  path: z.string().min(1),
  /** Hint for the matcher; "auto" decides per file. */
  kind: z.enum(["auto", "movies", "shows"]).default("auto"),
});
export type MediaFolder = z.infer<typeof mediaFolderSchema>;

/** The server's own settings, set by the server admin. */
export const serverSettingsSchema = z.object({
  serverName: z.string().min(1).max(64).default("Strata"),
  scanIntervalMinutes: z.number().int().min(0).default(60),
  hardwareAcceleration: z.boolean().default(true),
  maxTranscodes: z.number().int().min(1).max(16).default(3),
  /** Base URL of a Stremio stream addon (Torrentio-compatible); empty disables it. */
  torrentioUrl: z.string().default("https://torrentio.strem.fun"),
  // Network / updates (port and bind host stay CLI/env-driven on purpose).
  /** Advertise `_strata._tcp` on the LAN so the apps find the server. */
  bonjourEnabled: z.boolean().default(true),
  /** Devices on the home network join without a password, as a member they pick. */
  localJoin: z.boolean().default(true),
  /** Defaults to the channel this binary was published to. */
  updateChannel: z.enum(["stable", "nightly"]).default(BUILD_CHANNEL),
  /** Apply updates automatically once nothing is playing. */
  autoUpdate: z.boolean().default(false),
  /**
   * Advanced override for the signed update manifest (`{channel}` is replaced with the channel;
   * the signature is read from `<url>.sig`). Empty = the feed baked into the binary.
   */
  updateManifestUrl: z.union([z.literal(""), z.string().url()]).default(""),
});

/** A household's settings, set by its owner and admins. */
export const householdSettingsSchema = z.object({
  /** Local folders (a home server's household). */
  mediaFolders: z.array(mediaFolderSchema).default([]),
  language: z.string().default("en-US"),
  region: z.string().default("US"),
  torboxSyncMinutes: z.number().int().min(0).default(15),
  /** Remove releases Strata added to TorBox once unplayed this many days (0 = never). */
  torboxCleanupDays: z.number().int().min(0).max(365).default(14),
  sourcePriority: z.array(z.enum(["local", "torbox"])).default(["local", "torbox"]),
  maxResolution: z.number().int().default(2160),
  // Discovery: finding TorBox-playable releases for titles not in the library.
  discoveryEnabled: z.boolean().default(true),
  useTorboxSearch: z.boolean().default(true),
  /** Offer releases TorBox hasn't cached (they must download before playing). */
  showUncached: z.boolean().default(true),
  /** Largest release discovery will pick automatically, in GB (0 = no limit). */
  maxReleaseSizeGb: z.number().min(0).default(0),
});

/** What a household's code sees: the server's settings with its own on top. */
export const settingsSchema = serverSettingsSchema.merge(householdSettingsSchema);
export type Settings = z.infer<typeof settingsSchema>;
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
export type HouseholdSettings = z.infer<typeof householdSettingsSchema>;

/** The server admin's keys (shared by every household), and each household's own. */
export const SERVER_SECRET_KEYS = ["tmdbApiKey", "omdbApiKey"] as const;
export const HOUSEHOLD_SECRET_KEYS = ["torboxApiKey"] as const;
export const SECRET_KEYS = [...SERVER_SECRET_KEYS, ...HOUSEHOLD_SECRET_KEYS] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** Keys can come from the environment instead (read each time: tests and Workers set them late). */
const ENV_NAMES: Record<SecretKey, string> = { tmdbApiKey: "TMDB_API_KEY", omdbApiKey: "OMDB_API_KEY", torboxApiKey: "TORBOX_API_KEY" };

type Scope = { kind: "server" } | { kind: "household"; organizationId: string };

/**
 * Settings, the server's or one household's, as key/value rows. Plain settings are
 * JSON; secrets (API keys) are sealed with the server's SecretBox (AES-256-GCM, its key
 * outside the database), bound to their name (and household), and never returned by
 * the API.
 *
 * Read once (`load()`) and kept in memory, so reads stay cheap and synchronous; writes
 * go to the database first. Where other servers share the database, `reloadIfOlderThan`
 * picks up their changes.
 */
export class SettingsStore<S extends z.ZodTypeAny> {
  private cache?: z.infer<S>;
  private secrets = new Map<string, string>();
  private listeners = new Set<(s: z.infer<S>) => void>();
  private loadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly schema: S,
    private readonly secretKeys: readonly SecretKey[],
    private readonly scope: Scope = { kind: "server" },
  ) {}

  /** Reads every setting and secret into memory. Call before using the store. */
  async load(): Promise<void> {
    const rows = await this.rows();
    const raw: Record<string, unknown> = {};
    const secrets = new Map<string, string>();
    for (const row of rows) {
      if ((this.secretKeys as readonly string[]).includes(row.key)) {
        try {
          secrets.set(row.key, this.box.open(row.value, this.context(row.key)));
        } catch {
          // Sealed with another key (a lost or replaced STRATA_SECRET_KEY): treated as unset.
        }
        continue;
      }
      if (row.key in (this.schema as unknown as z.AnyZodObject).shape) raw[row.key] = JSON.parse(row.value);
    }
    const before = this.cache ? JSON.stringify(this.cache) : undefined;
    this.cache = this.schema.parse(raw);
    this.secrets = secrets;
    this.loadedAt = Date.now();
    if (before !== undefined && before !== JSON.stringify(this.cache)) for (const fn of this.listeners) fn(this.cache);
  }

  /** Reloads when the copy in memory is older than `ms` (other servers may have changed it). */
  async reloadIfOlderThan(ms: number) {
    if (Date.now() - this.loadedAt > ms) await this.load();
  }

  get(): z.infer<S> {
    if (!this.cache) throw new Error("SettingsStore.load() hasn't run");
    return this.cache;
  }

  async update(patch: Partial<z.infer<S>>): Promise<z.infer<S>> {
    const next = this.schema.parse({ ...this.get(), ...patch });
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        await this.put(tx as unknown as Db, key, JSON.stringify(next[key as keyof typeof next]));
      }
    });
    this.cache = next;
    for (const fn of this.listeners) fn(next);
    return next;
  }

  onChange(fn: (s: z.infer<S>) => void) {
    this.listeners.add(fn);
  }

  getSecret(key: SecretKey): string | undefined {
    return process.env[ENV_NAMES[key]] || this.secrets.get(key);
  }

  hasSecret(key: SecretKey): boolean {
    return this.getSecret(key) !== undefined;
  }

  async setSecret(key: SecretKey, value: string | null) {
    if (!this.secretKeys.includes(key)) throw new Error(`${key} isn't kept here`);
    if (value === null || value === "") {
      await this.remove(key);
      this.secrets.delete(key);
    } else {
      await this.put(this.db, key, this.box.seal(value, this.context(key)));
      this.secrets.set(key, value);
    }
    for (const fn of this.listeners) fn(this.get());
  }

  /** What a secret is sealed to: its name, and its household's id. */
  private context(key: string) {
    return this.scope.kind === "household" ? `${this.scope.organizationId}:${key}` : key;
  }

  private rows(): Promise<{ key: string; value: string }[]> {
    if (this.scope.kind === "server") return this.db.select().from(serverTable);
    return this.db.select({ key: householdTable.key, value: householdTable.value }).from(householdTable).where(eq(householdTable.organizationId, this.scope.organizationId));
  }

  private async put(db: Db, key: string, value: string) {
    if (this.scope.kind === "server") {
      await db.insert(serverTable).values({ key, value }).onConflictDoUpdate({ target: serverTable.key, set: { value } });
    } else {
      const organizationId = this.scope.organizationId;
      await db
        .insert(householdTable)
        .values({ organizationId, key, value })
        .onConflictDoUpdate({ target: [householdTable.organizationId, householdTable.key], set: { value } });
    }
  }

  private async remove(key: string) {
    if (this.scope.kind === "server") await this.db.delete(serverTable).where(eq(serverTable.key, key));
    else await this.db.delete(householdTable).where(and(eq(householdTable.organizationId, this.scope.organizationId), eq(householdTable.key, key)));
  }
}

export type ServerSettingsStore = SettingsStore<typeof serverSettingsSchema>;
export type HouseholdSettingsStore = SettingsStore<typeof householdSettingsSchema>;
