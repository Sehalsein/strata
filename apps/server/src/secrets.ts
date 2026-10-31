import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Encrypts API keys before they go into the database: AES-256-GCM with a key that is
 * never in the database itself, so a copy of the database alone reveals nothing.
 *
 * The key comes from `STRATA_SECRET_KEY` (base64, 32 bytes: the cloud server, which has
 * no disk of its own) or a file beside the data (a home server, created on first start).
 * Each value is bound to its setting's name, so one can't be moved into another's place.
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** `STRATA_SECRET_KEY` if set, else the key file at `path` (created when missing). */
  static load(path: string | null, env: string | undefined = process.env.STRATA_SECRET_KEY): SecretBox {
    if (env) return SecretBox.fromBase64(env, "STRATA_SECRET_KEY");
    if (!path) throw new Error("Set STRATA_SECRET_KEY (32 random bytes, base64: `openssl rand -base64 32`).");
    if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    return SecretBox.fromBase64(readFileSync(path, "utf8"), path);
  }

  static fromBase64(value: string, source: string): SecretBox {
    const key = Buffer.from(value.trim(), "base64");
    if (key.length !== 32) throw new Error(`The secret key in ${source} must be 32 bytes, base64-encoded.`);
    return new SecretBox(key);
  }

  /** Seals `plain`, bound to `context` (the setting's name). */
  seal(plain: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v2", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
  }

  /** Opens a value sealed for `context`. Throws if the key or the context doesn't match. */
  open(sealed: string, context: string): string {
    const [version, iv, tag, body] = sealed.split(".");
    if ((version !== "v1" && version !== "v2") || !iv || !tag || !body) throw new Error("Malformed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    if (version === "v2") decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  }
}
