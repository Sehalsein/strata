import { argon2idAsync } from "@noble/hashes/argon2.js";

// Argon2id in plain JavaScript, for Workers: they refuse to compile WebAssembly at run time,
// which WebAssembly hashing libraries do. Hashes use the standard encoded form
// (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`), so ones made at home by Bun.password verify here.

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/=+$/, "");

async function derive(password: string, salt: Uint8Array, m: number, t: number, p: number, dkLen: number) {
  return argon2idAsync(password, salt, { m, t, p, dkLen, maxmem: m * 1024 });
}

/** OWASP's Argon2id minimum (19 MiB, 2 passes): within a Worker's memory and CPU. */
export async function hashArgon2id(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const [m, t, p] = [19_456, 2, 1];
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(await derive(password, salt, m, t, p, 32))}`;
}

export async function verifyArgon2id(password: string, encoded: string): Promise<boolean> {
  const parts = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded);
  if (!parts) return false;
  const [m, t, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Hashes come from our own database; the cap only guards against a corrupt row.
  if (m > 256 * 1024 || t > 16 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const actual = await derive(password, salt, m, t, p, expected.length);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
