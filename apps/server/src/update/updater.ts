import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../log";
import { parseManifest, resolveManifestUrl, verifyManifestSignature, type Channel, type Manifest } from "./manifest";
import { readLastUpdate, writeMarker } from "./marker";
import { compareVersions, isPrerelease } from "./semver";

const log = logger("update");

export type UpdateState = "idle" | "checking" | "available" | "downloading" | "waiting-for-idle" | "restarting" | "error";

export interface UpdateStatus {
  currentVersion: string;
  platform: string;
  channel: Channel;
  autoUpdate: boolean;
  state: UpdateState;
  /** Null when this install can update itself; otherwise why not (dev run, Docker, no feed…). */
  disabledReason: string | null;
  /** The manifest being polled; null when this build has no feed and no override is set. */
  manifestUrl: string | null;
  latest: { version: string; publishedAt: string; minClientApi: number; notes: string | null; size: number | null } | null;
  updateAvailable: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  progress: { received: number; total: number } | null;
  lastUpdate: { result: "ok" | "rolled-back"; fromVersion: string; toVersion: string; at: string; message?: string } | null;
}

export interface UpdaterOptions {
  version: string;
  /** `${platform}-${arch}`, the manifest's platform key. */
  platform: string;
  dataDir: string;
  dbPath: string;
  /** The binary to replace; null disables applying updates. */
  binaryPath: string | null;
  disabledReason: string | null;
  publicKey: string;
  /** The feed root baked in at build time ("" in dev builds). */
  feedBaseUrl: string;
  settings: () => { updateChannel: Channel; autoUpdate: boolean; updateManifestUrl: string };
  activeSessions: () => number;
  /** Backs up the DB; returns the backup path (null when there is nothing to back up). */
  backupDb: () => string | null;
  fetch?: typeof fetch;
  idlePollMs?: number;
  /** Runs the downloaded binary with --version and returns what it prints. */
  probeVersion?: (binary: string) => Promise<string>;
  /** Ad-hoc signs the new binary (darwin). */
  codesign?: (binary: string) => Promise<void>;
}

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 500 | 502 = 500,
  ) {
    super(message);
  }
}

async function run(cmd: string[], timeoutMs = 20_000): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`${cmd[0]} exited with ${code}: ${(err || out).trim().slice(0, 300)}`);
  return out;
}

async function fetchOk(fetchImpl: typeof fetch, url: string): Promise<Response> {
  const res = await fetchImpl(url, { headers: { "User-Agent": "strata-server-updater" } });
  if (!res.ok) throw new UpdateError(`GET ${url} failed (${res.status})`, 502);
  return res;
}

/**
 * Whether `target` should replace `current` on `channel`. Normally only upgrades. The one
 * exception is leaving nightly: a prerelease build on the stable channel may move to a stable
 * version even if semver ranks it lower. Allowing downgrades in general would let a feed that
 * ever regressed move someone back onto a version they had passed.
 */
export function isUpdate(current: string, target: string, channel: Channel): boolean {
  const cmp = compareVersions(target, current);
  if (cmp > 0) return true;
  return cmp < 0 && channel === "stable" && isPrerelease(current) && !isPrerelease(target);
}

export const defaultProbeVersion = async (binary: string) => (await run([binary, "--version"])).trim();
export const defaultCodesign = async (binary: string) => {
  await run(["codesign", "--force", "--sign", "-", binary]);
};

export class Updater {
  private state: UpdateState = "idle";
  private latest: Manifest | null = null;
  private lastCheckedAt: number | null = null;
  private lastError: string | null = null;
  private progress: { received: number; total: number } | null = null;
  private busy: Promise<unknown> | null = null;
  private restartHandler: () => void = () => log.warn("Update installed; restart Strata to finish");
  private readonly fetchImpl: typeof fetch;
  /** A version that was rolled back; auto-update leaves it alone. */
  private readonly skipVersion: string | null;

  constructor(private readonly opts: UpdaterOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    const last = readLastUpdate(opts.dataDir);
    this.skipVersion = last?.result === "rolled-back" ? last.toVersion : null;
    if (last?.result === "rolled-back" && last.fromVersion === opts.version) {
      this.lastError = `Rolled back from v${last.toVersion}: ${last.message ?? "it failed to start"}`;
    }
  }

  /** Called once the new binary is in place; it must stop the server and exit/restart. */
  onRestart(fn: () => void) {
    this.restartHandler = fn;
  }

  get canApply() {
    return this.opts.binaryPath !== null;
  }

  status(): UpdateStatus {
    const s = this.opts.settings();
    const asset = this.latest?.platforms[this.opts.platform];
    const last = readLastUpdate(this.opts.dataDir);
    const manifestUrl = this.manifestUrl();
    return {
      currentVersion: this.opts.version,
      platform: this.opts.platform,
      channel: s.updateChannel,
      autoUpdate: s.autoUpdate,
      state: this.state,
      disabledReason: this.opts.disabledReason ?? (manifestUrl ? null : "Updates not configured: this build has no update feed (set a manifest URL override to use one)"),
      manifestUrl,
      latest: this.latest
        ? { version: this.latest.version, publishedAt: this.latest.publishedAt, minClientApi: this.latest.minClientApi, notes: this.latest.notes ?? null, size: asset?.size ?? null }
        : null,
      updateAvailable: this.isNewer(this.latest),
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
      progress: this.progress,
      lastUpdate: last,
    };
  }

  private manifestUrl(): string | null {
    const s = this.opts.settings();
    return resolveManifestUrl(this.opts.feedBaseUrl, s.updateManifestUrl, s.updateChannel);
  }

  private isNewer(m: Manifest | null): boolean {
    return !!m && !!m.platforms[this.opts.platform] && isUpdate(this.opts.version, m.version, this.opts.settings().updateChannel);
  }

  private assertIdle() {
    if (this.state === "downloading" || this.state === "waiting-for-idle" || this.state === "restarting") {
      throw new UpdateError(`An update is already in progress (${this.state})`, 409);
    }
  }

  /** Fetches and verifies the channel's manifest. */
  async check(): Promise<UpdateStatus> {
    this.assertIdle();
    if (this.busy) {
      await this.busy.catch(() => {});
      return this.status();
    }
    const job = this.doCheck();
    this.busy = job;
    try {
      await job;
    } finally {
      this.busy = null;
    }
    return this.status();
  }

  private async doCheck() {
    const channel = this.opts.settings().updateChannel;
    const url = this.manifestUrl();
    if (!url) {
      // Not configured is a state, not a failure: status() explains it via disabledReason.
      this.latest = null;
      this.lastError = null;
      this.state = "idle";
      return;
    }
    this.state = "checking";
    try {
      const [manifestBytes, sig] = await Promise.all([
        fetchOk(this.fetchImpl, url).then((r) => r.arrayBuffer()),
        fetchOk(this.fetchImpl, `${url}.sig`).then((r) => r.text()),
      ]);
      const bytes = new Uint8Array(manifestBytes);
      if (!verifyManifestSignature(bytes, sig, this.opts.publicKey)) throw new UpdateError("Update manifest signature is invalid", 502);
      const manifest = parseManifest(new TextDecoder().decode(bytes));
      if (manifest.channel !== channel) throw new UpdateError(`Manifest is for the ${manifest.channel} channel, expected ${channel}`, 502);
      this.latest = manifest;
      this.lastCheckedAt = Date.now();
      this.lastError = null;
      this.state = this.isNewer(manifest) ? "available" : "idle";
      if (this.state === "available") log.info(`Update available: v${manifest.version} (running v${this.opts.version})`);
      else if (!manifest.platforms[this.opts.platform] && isUpdate(this.opts.version, manifest.version, channel)) {
        log.warn(`v${manifest.version} has no build for ${this.opts.platform}`);
      }
    } catch (err) {
      this.lastCheckedAt = Date.now();
      this.fail(err);
      throw err instanceof UpdateError ? err : new UpdateError(errorText(err), 502);
    }
  }

  private fail(err: unknown) {
    this.state = "error";
    this.lastError = errorText(err);
    this.progress = null;
    log.error("Update failed", err);
  }

  /** Scheduled job: check, then apply when auto-update is on. */
  async checkAndMaybeApply(): Promise<unknown> {
    if (this.state === "downloading" || this.state === "waiting-for-idle" || this.state === "restarting") return { skipped: this.state };
    const status = await this.check();
    if (status.updateAvailable && status.autoUpdate && this.canApply && status.latest?.version !== this.skipVersion) {
      void this.apply().catch(() => {});
      return { applying: status.latest?.version };
    }
    return { latest: status.latest?.version ?? null, available: status.updateAvailable };
  }

  /** Starts applying in the background (API). Validates synchronously what it can. */
  startApply() {
    if (!this.canApply) throw new UpdateError(this.opts.disabledReason ?? "Self-update is disabled", 409);
    this.assertIdle();
    if (!this.isNewer(this.latest)) throw new UpdateError("No update available; check for updates first", 409);
    void this.apply().catch(() => {});
  }

  /**
   * Download → verify → wait for idle → back up DB → swap (keeping `.old`) → restart.
   * Resolves after the restart handler has been called.
   */
  async apply(opts: { waitForIdle?: boolean } = {}): Promise<void> {
    if (!this.opts.binaryPath) throw new UpdateError(this.opts.disabledReason ?? "Self-update is disabled", 409);
    this.assertIdle();
    if (this.busy) await this.busy.catch(() => {});
    const binary = this.opts.binaryPath;
    const newPath = `${binary}.new`;
    try {
      if (!this.isNewer(this.latest)) await this.check();
      const manifest = this.latest;
      if (!manifest || !this.isNewer(manifest)) {
        // Covers "already up to date" and refuses downgrades.
        throw new UpdateError(manifest ? `v${manifest.version} is not an update from v${this.opts.version}` : "No update available", 409);
      }
      const asset = manifest.platforms[this.opts.platform]!;
      try {
        accessSync(dirname(binary), constants.W_OK);
      } catch {
        throw new UpdateError(`Can't write to ${dirname(binary)}; reinstall with \`strata-server service install\` to use a user-writable location`, 409);
      }

      this.state = "downloading";
      this.progress = { received: 0, total: asset.size };
      log.info(`Downloading v${manifest.version} for ${this.opts.platform}`);
      rmSync(newPath, { force: true });
      const res = await fetchOk(this.fetchImpl, asset.url);
      const hash = createHash("sha256");
      const writer = Bun.file(newPath).writer();
      let received = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          writer.write(chunk);
          received += chunk.byteLength;
          this.progress = { received, total: asset.size };
          if (received > asset.size) throw new UpdateError("Download is larger than the manifest says", 502);
        }
      } finally {
        await writer.end();
      }
      if (received !== asset.size) throw new UpdateError(`Download size mismatch (${received} ≠ ${asset.size})`, 502);
      const digest = hash.digest("hex");
      if (digest !== asset.sha256) throw new UpdateError("Download checksum mismatch", 502);
      chmodSync(newPath, 0o755);
      if (process.platform === "darwin") await (this.opts.codesign ?? defaultCodesign)(newPath);
      const reported = await (this.opts.probeVersion ?? defaultProbeVersion)(newPath).catch((err) => {
        throw new UpdateError(`The new binary doesn't run on this machine: ${errorText(err)}`, 502);
      });
      if (reported !== manifest.version) throw new UpdateError(`The new binary reports v${reported}, expected v${manifest.version}`, 502);

      if (opts.waitForIdle !== false) {
        this.state = "waiting-for-idle";
        while (this.opts.activeSessions() > 0) {
          if (this.state !== "waiting-for-idle") return;
          await Bun.sleep(this.opts.idlePollMs ?? 5_000);
        }
      }

      const dbBackupPath = this.opts.backupDb();
      const oldPath = `${binary}.old`;
      writeMarker(this.opts.dataDir, {
        fromVersion: this.opts.version,
        toVersion: manifest.version,
        binaryPath: binary,
        backupBinaryPath: oldPath,
        dbPath: this.opts.dbPath,
        dbBackupPath,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      swapBinary(binary, newPath, oldPath);
      log.info(`Installed v${manifest.version} (previous binary kept at ${oldPath}); restarting`);
      this.state = "restarting";
      this.progress = null;
      this.restartHandler();
    } catch (err) {
      rmSync(newPath, { force: true });
      this.fail(err);
      throw err instanceof UpdateError ? err : new UpdateError(errorText(err));
    }
  }
}

/** binary → old, new → binary. Puts the old one back if the second rename fails. */
export function swapBinary(binary: string, newPath: string, oldPath: string) {
  rmSync(oldPath, { force: true });
  renameSync(binary, oldPath);
  try {
    renameSync(newPath, binary);
  } catch (err) {
    renameSync(oldPath, binary);
    throw err;
  }
  if (!existsSync(binary)) throw new Error(`Swap failed: ${binary} is missing`);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
