import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { isValidVersion } from "./semver";

/** Release targets, keyed the way `${process.platform}-${process.arch}` spells them. */
export const PLATFORM_KEYS = ["darwin-arm64", "linux-x64", "linux-arm64"] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export const CHANNELS = ["stable", "nightly"] as const;
export type Channel = (typeof CHANNELS)[number];

export const platformAssetSchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  size: z.number().int().positive(),
});
export type PlatformAsset = z.infer<typeof platformAssetSchema>;

export const manifestSchema = z.object({
  version: z.string().refine(isValidVersion, "version must be semver"),
  channel: z.enum(CHANNELS),
  publishedAt: z.string(),
  /** Oldest client API version this server release still serves. */
  minClientApi: z.number().int().min(0),
  notes: z.string().optional(),
  platforms: z.record(z.string(), platformAssetSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;

export function currentPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

/** Parses manifest JSON. Throws with a readable message when it's malformed. */
export function parseManifest(text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Update manifest is not valid JSON");
  }
  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Update manifest is invalid: ${issue?.path.join(".") || "root"}: ${issue?.message}`);
  }
  return result.data;
}

export function manifestUrlFor(template: string, channel: Channel): string {
  return template.replaceAll("{channel}", channel).replaceAll("%7Bchannel%7D", channel);
}

/**
 * Where to read the manifest: the dashboard override when set, otherwise the feed baked into
 * the binary (`<base>/manifest.json` for stable, `<base>/nightly/manifest.json` for nightly).
 * Null when there is neither (a dev build).
 */
export function resolveManifestUrl(baseUrl: string, override: string, channel: Channel): string | null {
  if (override.trim()) return manifestUrlFor(override.trim(), channel);
  const base = baseUrl.replace(/\/+$/, "");
  if (!base) return null;
  return channel === "nightly" ? `${base}/nightly/manifest.json` : `${base}/manifest.json`;
}

/**
 * Accepts a PEM key or base64 DER (PKCS#8 for private keys, SPKI for public keys).
 * Base64 DER is what `scripts/keygen.ts` prints, because it fits in one line (handy for CI secrets).
 */
export function loadPrivateKey(input: string): KeyObject {
  const text = input.trim();
  const key = text.includes("-----BEGIN") ? createPrivateKey(text) : createPrivateKey({ key: Buffer.from(text, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`Expected an Ed25519 private key, got ${key.asymmetricKeyType}`);
  return key;
}

export function loadPublicKey(input: string): KeyObject {
  const text = input.trim();
  const key = text.includes("-----BEGIN") ? createPublicKey(text) : createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`Expected an Ed25519 public key, got ${key.asymmetricKeyType}`);
  return key;
}

/** Signs the exact manifest bytes; the result is base64 (the content of `manifest.json.sig`). */
export function signManifest(data: string | Uint8Array, privateKey: KeyObject | string): string {
  const key = typeof privateKey === "string" ? loadPrivateKey(privateKey) : privateKey;
  return sign(null, Buffer.from(data), key).toString("base64");
}

/** True only for a valid Ed25519 signature over exactly these bytes. Never throws. */
export function verifyManifestSignature(data: string | Uint8Array, signatureBase64: string, publicKey: KeyObject | string): boolean {
  try {
    const key = typeof publicKey === "string" ? loadPublicKey(publicKey) : publicKey;
    const sig = Buffer.from(signatureBase64.trim(), "base64");
    if (sig.length !== 64) return false;
    return verify(null, Buffer.from(data), key, sig);
  } catch {
    return false;
  }
}
