import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** AES-256-GCM with a per-install key kept beside the database (not inside it). */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static load(path: string): SecretBox {
    if (!existsSync(path)) {
      writeFileSync(path, randomBytes(32).toString("base64"));
      chmodSync(path, 0o600);
    }
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error(`Invalid secret key at ${path}`);
    return new SecretBox(key);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
  }

  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !body) throw new Error("Malformed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  }
}
