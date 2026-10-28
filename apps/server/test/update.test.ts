import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrivateKey, loadPublicKey, manifestUrlFor, parseManifest, resolveManifestUrl, signManifest, verifyManifestSignature, type Manifest } from "../src/update/manifest";
import { bootCheck, decideBoot, markHealthy, MAX_FAILED_BOOTS, readLastUpdate, readMarker, writeMarker, type PendingUpdate } from "../src/update/marker";
import { UPDATE_PUBLIC_KEY } from "../src/update/publicKey";
import { compareVersions, isValidVersion } from "../src/update/semver";
import { isUpdate, swapBinary, Updater } from "../src/update/updater";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateB64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

const sampleManifest = (over: Partial<Manifest> = {}): Manifest => ({
  version: "0.2.0",
  channel: "stable",
  publishedAt: "2026-10-20T00:00:00.000Z",
  minClientApi: 1,
  platforms: { "darwin-arm64": { url: "https://example.com/strata-server-darwin-arm64", sha256: "a".repeat(64), size: 10 } },
  ...over,
});

describe("versions", () => {
  test("compares semver including prereleases", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
  });

  test("only moves forward, except nightly → stable on the stable channel", () => {
    expect(isUpdate("0.3.0", "0.3.1-nightly.41", "nightly")).toBe(true);
    expect(isUpdate("0.3.1-nightly.41", "0.3.1-nightly.42", "nightly")).toBe(true);
    expect(isUpdate("0.3.1-nightly.42", "0.3.1", "stable")).toBe(true);
    expect(isUpdate("0.3.1-nightly.42", "0.3.0", "stable")).toBe(true); // leaving nightly
    expect(isUpdate("0.3.1-nightly.42", "0.3.0", "nightly")).toBe(false);
    expect(isUpdate("0.3.1", "0.3.0", "stable")).toBe(false);
    expect(isUpdate("0.3.1", "0.3.1", "stable")).toBe(false);
    expect(isUpdate("0.3.1-nightly.42", "0.3.1-nightly.40", "stable")).toBe(false);
  });

  test("rejects junk", () => {
    expect(isValidVersion("1.2")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(() => compareVersions("x", "1.0.0")).toThrow();
  });
});

describe("manifest", () => {
  test("parses a valid manifest", () => {
    const m = parseManifest(JSON.stringify(sampleManifest()));
    expect(m.version).toBe("0.2.0");
    expect(m.platforms["darwin-arm64"]?.size).toBe(10);
  });

  test("rejects invalid manifests with a readable error", () => {
    expect(() => parseManifest("{nope")).toThrow(/not valid JSON/);
    expect(() => parseManifest(JSON.stringify(sampleManifest({ version: "two" })))).toThrow(/version/);
    expect(() => parseManifest(JSON.stringify({ ...sampleManifest(), channel: "beta" }))).toThrow(/channel/);
    const badHash = sampleManifest();
    badHash.platforms["darwin-arm64"]!.sha256 = "xyz";
    expect(() => parseManifest(JSON.stringify(badHash))).toThrow(/sha256/);
  });

  test("substitutes the channel into the URL template", () => {
    expect(manifestUrlFor("https://h/server-{channel}/manifest.json", "nightly")).toBe("https://h/server-nightly/manifest.json");
    expect(manifestUrlFor("https://h/server-%7Bchannel%7D/manifest.json", "stable")).toBe("https://h/server-stable/manifest.json");
  });
});

describe("signatures", () => {
  const k = keypair();
  const text = JSON.stringify(sampleManifest());

  test("verifies with base64 DER and PEM keys", () => {
    const sig = signManifest(text, k.privateB64);
    expect(verifyManifestSignature(text, sig, k.publicB64)).toBe(true);
    expect(verifyManifestSignature(text, signManifest(text, k.privatePem), k.publicPem)).toBe(true);
    expect(verifyManifestSignature(new TextEncoder().encode(text), sig, k.publicB64)).toBe(true);
  });

  test("rejects tampered data, wrong keys and garbage signatures", () => {
    const sig = signManifest(text, k.privateB64);
    expect(verifyManifestSignature(text.replace("0.2.0", "9.9.9"), sig, k.publicB64)).toBe(false);
    expect(verifyManifestSignature(text, sig, keypair().publicB64)).toBe(false);
    expect(verifyManifestSignature(text, "not-a-signature", k.publicB64)).toBe(false);
    expect(verifyManifestSignature(text, sig, "garbage")).toBe(false);
  });

  test("refuses non-Ed25519 keys", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });
    expect(() => loadPrivateKey(rsa.privateKey.export({ format: "pem", type: "pkcs8" }).toString())).toThrow(/Ed25519/);
  });

  test("the embedded public key is a valid Ed25519 key", () => {
    expect(loadPublicKey(UPDATE_PUBLIC_KEY).asymmetricKeyType).toBe("ed25519");
  });
});

describe("feed URL", () => {
  test("derives the channel's manifest from the baked base", () => {
    expect(resolveManifestUrl("https://updates.example.com/server", "", "stable")).toBe("https://updates.example.com/server/manifest.json");
    expect(resolveManifestUrl("https://updates.example.com/server/", "", "nightly")).toBe("https://updates.example.com/server/nightly/manifest.json");
    const github = "https://github.com/o/r/releases/download/server-{channel}";
    expect(resolveManifestUrl(github, "", "stable")).toBe("https://github.com/o/r/releases/download/server-stable/manifest.json");
    expect(resolveManifestUrl(github, "", "nightly")).toBe("https://github.com/o/r/releases/download/server-nightly/manifest.json");
  });

  test("the override wins, with {channel} substituted", () => {
    expect(resolveManifestUrl("https://u/server", "http://127.0.0.1:9/{channel}/manifest.json", "nightly")).toBe("http://127.0.0.1:9/nightly/manifest.json");
    expect(resolveManifestUrl("", "http://127.0.0.1:9/m.json", "stable")).toBe("http://127.0.0.1:9/m.json");
  });

  test("dev builds have no feed", () => {
    expect(resolveManifestUrl("", "", "stable")).toBeNull();
  });
});

describe("rollback marker", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strata-update-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const marker = (over: Partial<PendingUpdate> = {}): PendingUpdate => ({
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    binaryPath: join(dir, "strata-server"),
    backupBinaryPath: join(dir, "strata-server.old"),
    dbPath: join(dir, "strata.db"),
    dbBackupPath: join(dir, "backup.db"),
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...over,
  });

  test("decideBoot", () => {
    expect(decideBoot(null, "0.2.0").action).toBe("none");
    expect(decideBoot(marker(), "0.1.0").action).toBe("clear");
    const first = decideBoot(marker(), "0.2.0");
    expect(first).toEqual({ action: "continue", marker: marker({ attempts: 1, createdAt: first.action === "continue" ? first.marker.createdAt : "" }) });
    expect(decideBoot(marker({ attempts: MAX_FAILED_BOOTS }), "0.2.0").action).toBe("rollback");
  });

  test("a healthy boot clears the marker", () => {
    writeMarker(dir, marker());
    expect(bootCheck(dir, "0.2.0")).toBe("trial");
    expect(readMarker(dir)?.attempts).toBe(1);
    expect(markHealthy(dir, "0.2.0")).toBe(true);
    expect(readMarker(dir)).toBeNull();
    expect(readLastUpdate(dir)).toMatchObject({ result: "ok", fromVersion: "0.1.0", toVersion: "0.2.0" });
  });

  test("rolls back binary and database after repeated failed boots", () => {
    writeFileSync(join(dir, "strata-server"), "new-binary");
    writeFileSync(join(dir, "strata-server.old"), "old-binary");
    writeFileSync(join(dir, "strata.db"), "migrated-db");
    writeFileSync(join(dir, "strata.db-wal"), "wal");
    writeFileSync(join(dir, "backup.db"), "original-db");
    writeMarker(dir, marker());

    expect(bootCheck(dir, "0.2.0")).toBe("trial"); // boot 1 crashes…
    expect(bootCheck(dir, "0.2.0")).toBe("trial"); // boot 2 crashes…
    expect(bootCheck(dir, "0.2.0")).toBe("rolled-back");

    expect(readFileSync(join(dir, "strata-server"), "utf8")).toBe("old-binary");
    expect(existsSync(join(dir, "strata-server.old"))).toBe(false);
    expect(readFileSync(join(dir, "strata.db"), "utf8")).toBe("original-db");
    expect(existsSync(join(dir, "strata.db-wal"))).toBe(false);
    expect(readMarker(dir)).toBeNull();
    expect(readLastUpdate(dir)).toMatchObject({ result: "rolled-back", toVersion: "0.2.0" });
    // The restored old version boots normally.
    expect(bootCheck(dir, "0.1.0")).toBe("none");
  });

  test("a stale marker for another version is cleared", () => {
    writeMarker(dir, marker());
    expect(bootCheck(dir, "0.1.0")).toBe("cleared");
    expect(readMarker(dir)).toBeNull();
  });

  test("swapBinary keeps the old binary", () => {
    const bin = join(dir, "bin");
    writeFileSync(bin, "old");
    writeFileSync(`${bin}.new`, "new");
    swapBinary(bin, `${bin}.new`, `${bin}.old`);
    expect(readFileSync(bin, "utf8")).toBe("new");
    expect(readFileSync(`${bin}.old`, "utf8")).toBe("old");
    expect(existsSync(`${bin}.new`)).toBe(false);
  });
});

describe("Updater", () => {
  let dir: string;
  const k = keypair();
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strata-updater-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function setup(opts: { version: string; manifest: Manifest; binary: Uint8Array; sessions?: () => number; signWith?: string }) {
    const text = JSON.stringify(opts.manifest);
    const sig = signManifest(text, opts.signWith ?? k.privateB64);
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://u.test/manifest.json") return new Response(text);
      if (url === "https://u.test/manifest.json.sig") return new Response(sig);
      if (url === "https://u.test/bin") return new Response(opts.binary);
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    const binaryPath = join(dir, "strata-server");
    writeFileSync(binaryPath, "old-binary");
    let restarted = 0;
    const updater = new Updater({
      version: opts.version,
      platform: "darwin-arm64",
      dataDir: dir,
      dbPath: join(dir, "strata.db"),
      binaryPath,
      disabledReason: null,
      publicKey: k.publicB64,
      feedBaseUrl: "https://u.test",
      settings: () => ({ updateChannel: "stable", autoUpdate: false, updateManifestUrl: "" }),
      activeSessions: opts.sessions ?? (() => 0),
      backupDb: () => null,
      fetch: fake,
      idlePollMs: 5,
      probeVersion: async () => opts.manifest.version,
      codesign: async () => {},
    });
    updater.onRestart(() => restarted++);
    return { updater, binaryPath, restarts: () => restarted };
  }

  const binary = new TextEncoder().encode("new-binary-contents");
  const asset = { url: "https://u.test/bin", sha256: createHash("sha256").update(binary).digest("hex"), size: binary.length };

  test("check reports an available update", async () => {
    const { updater } = setup({ version: "0.1.0", manifest: sampleManifest({ platforms: { "darwin-arm64": asset } }), binary });
    const status = await updater.check();
    expect(status.state).toBe("available");
    expect(status.updateAvailable).toBe(true);
    expect(status.latest?.version).toBe("0.2.0");
  });

  test("a bad signature is an error, not an update", async () => {
    const { updater } = setup({ version: "0.1.0", manifest: sampleManifest({ platforms: { "darwin-arm64": asset } }), binary, signWith: keypair().privateB64 });
    await expect(updater.check()).rejects.toThrow(/signature/);
    expect(updater.status().state).toBe("error");
    expect(updater.status().updateAvailable).toBe(false);
  });

  test("refuses downgrades", async () => {
    const { updater } = setup({ version: "0.3.0", manifest: sampleManifest({ platforms: { "darwin-arm64": asset } }), binary });
    expect((await updater.check()).updateAvailable).toBe(false);
    await expect(updater.apply()).rejects.toThrow(/not an update/);
  });

  test("a nightly build on the stable channel is offered the stable release", async () => {
    const { updater } = setup({ version: "0.2.1-nightly.7", manifest: sampleManifest({ platforms: { "darwin-arm64": asset } }), binary });
    expect((await updater.check()).updateAvailable).toBe(true);
  });

  test("the manifest must be for the configured channel", async () => {
    const { updater } = setup({ version: "0.1.0", manifest: sampleManifest({ channel: "nightly", platforms: { "darwin-arm64": asset } }), binary });
    await expect(updater.check()).rejects.toThrow(/nightly channel/);
  });

  test("apply downloads, verifies, waits for idle, swaps and restarts", async () => {
    let active = 1;
    const { updater, binaryPath, restarts } = setup({ version: "0.1.0", manifest: sampleManifest({ platforms: { "darwin-arm64": asset } }), binary, sessions: () => active });
    await updater.check();
    const done = updater.apply();
    await Bun.sleep(30);
    expect(updater.status().state).toBe("waiting-for-idle");
    active = 0;
    await done;
    expect(restarts()).toBe(1);
    expect(updater.status().state).toBe("restarting");
    expect(readFileSync(binaryPath, "utf8")).toBe("new-binary-contents");
    expect(readFileSync(`${binaryPath}.old`, "utf8")).toBe("old-binary");
    expect(readMarker(dir)).toMatchObject({ fromVersion: "0.1.0", toVersion: "0.2.0", attempts: 0 });
  });

  test("a checksum mismatch leaves the binary alone", async () => {
    const { updater, binaryPath } = setup({ version: "0.1.0", manifest: sampleManifest({ platforms: { "darwin-arm64": { ...asset, sha256: "b".repeat(64) } } }), binary });
    await updater.check();
    await expect(updater.apply()).rejects.toThrow(/checksum/);
    expect(readFileSync(binaryPath, "utf8")).toBe("old-binary");
    expect(existsSync(`${binaryPath}.new`)).toBe(false);
    expect(readMarker(dir)).toBeNull();
  });
});

describe("Updater without a feed", () => {
  test("reports 'not configured' instead of erroring", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strata-nofeed-"));
    const updater = new Updater({
      version: "0.1.0",
      platform: "darwin-arm64",
      dataDir: dir,
      dbPath: join(dir, "strata.db"),
      binaryPath: null,
      disabledReason: null,
      publicKey: UPDATE_PUBLIC_KEY,
      feedBaseUrl: "",
      settings: () => ({ updateChannel: "stable", autoUpdate: false, updateManifestUrl: "" }),
      activeSessions: () => 0,
      backupDb: () => null,
      fetch: (async () => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch,
    });
    const status = await updater.check();
    expect(status.state).toBe("idle");
    expect(status.lastError).toBeNull();
    expect(status.manifestUrl).toBeNull();
    expect(status.disabledReason).toMatch(/not configured/);
    rmSync(dir, { recursive: true, force: true });
  });
});
