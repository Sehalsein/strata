// Writes a signed update manifest for a set of built binaries.
//
//   STRATA_UPDATE_PRIVATE_KEY=... bun scripts/release-manifest.ts \
//     --version 0.2.1-nightly.42 --channel nightly --dir dist \
//     --base-url https://updates.example.com/server/nightly --out dist/feed
//
// Picks up dist/strata-server-<platform> for every release platform present, and writes
// <out>/manifest.json plus <out>/manifest.json.sig (base64 Ed25519 signature over the exact
// bytes of manifest.json). Binaries are referenced as <base-url>/strata-server-<version>-<platform>
// (versioned, so they can be cached forever); the caller uploads them under those names.
// The private key comes from STRATA_UPDATE_PRIVATE_KEY (base64 PKCS#8 DER as printed by scripts/keygen.ts, or a PEM block) or --key-file. The signature is checked
// against the public key compiled into the server, so a wrong key fails here, not on users' machines.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_VERSION } from "../src/version";
import { CHANNELS, loadPrivateKey, parseManifest, PLATFORM_KEYS, signManifest, verifyManifestSignature, type Channel, type Manifest } from "../src/update/manifest";
import { UPDATE_PUBLIC_KEY } from "../src/update/publicKey";
import { isValidVersion } from "../src/update/semver";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const version = flag("--version") ?? fail("--version is required");
if (!isValidVersion(version)) fail(`Invalid version ${version}`);
const channel = (flag("--channel") ?? "stable") as Channel;
if (!CHANNELS.includes(channel)) fail(`--channel must be one of ${CHANNELS.join(", ")}`);
const dir = resolve(flag("--dir") ?? "dist");
const baseUrl = (flag("--base-url") ?? fail("--base-url is required")).replace(/\/+$/, "");
const out = resolve(flag("--out") ?? dir);
const minClientApi = Number(flag("--min-client-api") ?? API_VERSION);
const notes = flag("--notes");

const keyFile = flag("--key-file");
const keyText = keyFile ? readFileSync(keyFile, "utf8") : process.env.STRATA_UPDATE_PRIVATE_KEY;
if (!keyText?.trim()) fail("Set STRATA_UPDATE_PRIVATE_KEY (or pass --key-file); generate one with scripts/keygen.ts");
const privateKey = loadPrivateKey(keyText!);

const platforms: Manifest["platforms"] = {};
for (const platform of PLATFORM_KEYS) {
  const file = join(dir, `strata-server-${platform}`);
  if (!existsSync(file)) continue;
  const data = readFileSync(file);
  platforms[platform] = {
    url: `${baseUrl}/strata-server-${version}-${platform}`,
    sha256: createHash("sha256").update(data).digest("hex"),
    size: statSync(file).size,
  };
}
if (Object.keys(platforms).length === 0) fail(`No strata-server-<platform> binaries found in ${dir}`);

const manifest: Manifest = {
  version,
  channel,
  publishedAt: new Date().toISOString(),
  minClientApi,
  ...(notes ? { notes } : {}),
  platforms,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
parseManifest(text); // the server must accept what we publish

const signature = signManifest(text, privateKey);
if (!verifyManifestSignature(text, signature, UPDATE_PUBLIC_KEY)) {
  fail("The signing key does not match src/update/publicKey.ts; servers would reject this manifest.");
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "manifest.json"), text);
writeFileSync(join(out, "manifest.json.sig"), signature + "\n");
console.log(`Wrote ${join(out, "manifest.json")} (v${version}, ${channel}; ${Object.keys(platforms).join(", ")})`);
