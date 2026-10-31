import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db";
import { settings as settingsTable } from "./db/schema";
import type { SecretBox } from "./secrets";
import { BUILD_CHANNEL } from "./version";

export const mediaFolderSchema = z.object({
  path: z.string().min(1),
  /** Hint for the matcher; "auto" decides per file. */
  kind: z.enum(["auto", "movies", "shows"]).default("auto"),
});
export type MediaFolder = z.infer<typeof mediaFolderSchema>;

export const settingsSchema = z.object({
  serverName: z.string().min(1).max(64).default("Strata"),
  mediaFolders: z.array(mediaFolderSchema).default([]),
  language: z.string().default("en-US"),
  region: z.string().default("US"),
  scanIntervalMinutes: z.number().int().min(0).default(60),
  torboxSyncMinutes: z.number().int().min(0).default(15),
  /** Remove releases Strata added to TorBox once unplayed this many days (0 = never). */
  torboxCleanupDays: z.number().int().min(0).max(365).default(14),
  sourcePriority: z.array(z.enum(["local", "torbox"])).default(["local", "torbox"]),
  maxResolution: z.number().int().default(2160),
  hardwareAcceleration: z.boolean().default(true),
  maxTranscodes: z.number().int().min(1).max(16).default(3),
  // Discovery: finding TorBox-playable releases for titles not in the library.
  discoveryEnabled: z.boolean().default(true),
  /** Base URL of a Stremio stream addon (Torrentio-compatible); empty disables it. */
  torrentioUrl: z.string().default("https://torrentio.strem.fun"),
  useTorboxSearch: z.boolean().default(true),
  /** Offer releases TorBox hasn't cached (they must download before playing). */
  showUncached: z.boolean().default(true),
  /** Largest release discovery will pick automatically, in GB (0 = no limit). */
  maxReleaseSizeGb: z.number().min(0).default(0),
  // Network / updates (port and bind host stay CLI/env-driven on purpose).
  /** Advertise `_strata._tcp` on the LAN so the apps find the server. */
  bonjourEnabled: z.boolean().default(true),
  /** Devices on the home network join without a password and go straight to the profile picker. */
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
export type Settings = z.infer<typeof settingsSchema>;

export const SECRET_KEYS = ["tmdbApiKey", "torboxApiKey", "omdbApiKey"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/**
 * Settings live in the `settings` key/value table. Plain settings are stored as JSON;
 * secrets (API keys) are sealed with the server's SecretBox (AES-256-GCM, its key kept
 * outside the database) and are never returned by the API.
 *
 * Everything is read once at start (`load()`) and kept in memory, so reads stay cheap
 * and synchronous; writes go to the database first. A cloud server, where another
 * instance may change them, reloads every minute (`watch()`).
 */
export class SettingsStore {
  private cache?: Settings;
  private secrets = new Map<SecretKey, string>();
  private listeners = new Set<(s: Settings) => void>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
  ) {}

  /** Reads every setting and secret into memory. Call before using the store. */
  async load(): Promise<void> {
    const rows = await this.db.select().from(settingsTable);
    const raw: Record<string, unknown> = {};
    const secrets = new Map<SecretKey, string>();
    for (const row of rows) {
      if ((SECRET_KEYS as readonly string[]).includes(row.key)) {
        try {
          secrets.set(row.key as SecretKey, this.box.open(row.value, row.key));
        } catch {
          // Sealed with another key (a lost or replaced STRATA_SECRET_KEY): treated as unset.
        }
        continue;
      }
      raw[row.key] = JSON.parse(row.value);
    }
    const before = this.cache ? JSON.stringify(this.cache) : undefined;
    this.cache = settingsSchema.parse(raw);
    this.secrets = secrets;
    if (before !== undefined && before !== JSON.stringify(this.cache)) for (const fn of this.listeners) fn(this.cache);
  }

  /** Reloads every `intervalMs` (changes made by other servers sharing the database). */
  watch(intervalMs = 60_000) {
    setInterval(() => void this.load().catch(() => {}), intervalMs).unref?.();
  }

  get(): Settings {
    if (!this.cache) throw new Error("SettingsStore.load() hasn't run");
    return this.cache;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = settingsSchema.parse({ ...this.get(), ...patch });
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const json = JSON.stringify(next[key as keyof Settings]);
        await tx.insert(settingsTable).values({ key, value: json }).onConflictDoUpdate({ target: settingsTable.key, set: { value: json } });
      }
    });
    this.cache = next;
    for (const fn of this.listeners) fn(next);
    return next;
  }

  onChange(fn: (s: Settings) => void) {
    this.listeners.add(fn);
  }

  getSecret(key: SecretKey): string | undefined {
    const env = { tmdbApiKey: process.env.TMDB_API_KEY, torboxApiKey: process.env.TORBOX_API_KEY, omdbApiKey: process.env.OMDB_API_KEY }[key];
    return env || this.secrets.get(key);
  }

  async setSecret(key: SecretKey, value: string | null) {
    if (value === null || value === "") {
      await this.db.delete(settingsTable).where(eq(settingsTable.key, key));
      this.secrets.delete(key);
    } else {
      const sealed = this.box.seal(value, key);
      await this.db.insert(settingsTable).values({ key, value: sealed }).onConflictDoUpdate({ target: settingsTable.key, set: { value: sealed } });
      this.secrets.set(key, value);
    }
    for (const fn of this.listeners) fn(this.get());
  }

  hasSecret(key: SecretKey): boolean {
    return this.getSecret(key) !== undefined;
  }
}
