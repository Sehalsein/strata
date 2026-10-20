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

export const SECRET_KEYS = ["tmdbApiKey", "torboxApiKey"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/**
 * Settings live in the `settings` key/value table. Plain settings are stored as JSON;
 * secrets are sealed with the install's SecretBox and are never returned by the API.
 */
export class SettingsStore {
  private cache?: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
  ) {}

  get(): Settings {
    if (this.cache) return this.cache;
    const rows = this.db.select().from(settingsTable).all();
    const raw: Record<string, unknown> = {};
    for (const row of rows) {
      if ((SECRET_KEYS as readonly string[]).includes(row.key)) continue;
      raw[row.key] = JSON.parse(row.value);
    }
    this.cache = settingsSchema.parse(raw);
    return this.cache;
  }

  update(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.get(), ...patch });
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const json = JSON.stringify(next[key as keyof Settings]);
        tx.insert(settingsTable).values({ key, value: json }).onConflictDoUpdate({ target: settingsTable.key, set: { value: json } }).run();
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
    const env = key === "tmdbApiKey" ? process.env.TMDB_API_KEY : process.env.TORBOX_API_KEY;
    if (env) return env;
    const row = this.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get();
    return row ? this.box.open(row.value) : undefined;
  }

  setSecret(key: SecretKey, value: string | null) {
    if (value === null || value === "") {
      this.db.delete(settingsTable).where(eq(settingsTable.key, key)).run();
    } else {
      const sealed = this.box.seal(value);
      this.db.insert(settingsTable).values({ key, value: sealed }).onConflictDoUpdate({ target: settingsTable.key, set: { value: sealed } }).run();
    }
    for (const fn of this.listeners) fn(this.get());
  }

  hasSecret(key: SecretKey): boolean {
    return this.getSecret(key) !== undefined;
  }
}
