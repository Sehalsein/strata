import type { Subprocess } from "bun";
import { logger } from "../log";

const log = logger("bonjour");
export const SERVICE_TYPE = "_strata._tcp";

export interface Advert {
  name: string;
  port: number;
  txt: Record<string, string>;
}

/**
 * The OS tool that registers a DNS-SD service for as long as it runs, or null when this
 * platform has none. Pure, so it's testable; `which` is injectable.
 */
export function advertiseCommand(advert: Advert, platform: string = process.platform, which: (bin: string) => string | null = Bun.which): string[] | null {
  const txt = Object.entries(advert.txt).map(([k, v]) => `${k}=${v}`);
  // DNS-SD instance names are at most 63 bytes.
  const name = advert.name.slice(0, 63);
  if (platform === "darwin") {
    const bin = which("dns-sd");
    return bin ? [bin, "-R", name, SERVICE_TYPE, "local", String(advert.port), ...txt] : null;
  }
  if (platform === "linux") {
    const bin = which("avahi-publish-service") ?? which("avahi-publish");
    if (!bin) return null;
    return bin.endsWith("avahi-publish") ? [bin, "-s", name, SERVICE_TYPE, String(advert.port), ...txt] : [bin, name, SERVICE_TYPE, String(advert.port), ...txt];
  }
  return null;
}

/**
 * Advertises the server on the LAN by keeping `dns-sd -R` (macOS) or `avahi-publish-service`
 * (Linux) running. Restarted when the name changes; killed on shutdown.
 */
export class Bonjour {
  private proc?: Subprocess;
  private current?: string;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private warnedUnavailable = false;
  private started = false;
  private stopped = false;

  constructor(private readonly advert: () => Advert | null) {}

  start() {
    this.started = true;
    this.refresh();
  }

  /** (Re)applies the current advert: starts, restarts on change, or stops when disabled. No-op before start(). */
  refresh() {
    if (!this.started || this.stopped) return;
    const advert = this.advert();
    const key = advert ? JSON.stringify(advert) : undefined;
    if (key === this.current && (this.proc || !advert)) return;
    this.kill();
    this.current = key;
    this.failures = 0;
    if (advert) this.spawn(advert);
  }

  get active(): boolean {
    return !!this.proc;
  }

  private spawn(advert: Advert) {
    const cmd = advertiseCommand(advert);
    if (!cmd) {
      if (!this.warnedUnavailable) {
        log.warn(process.platform === "linux" ? "LAN discovery unavailable: install avahi-utils (avahi-publish-service)" : `LAN discovery isn't supported on ${process.platform}`);
        this.warnedUnavailable = true;
      }
      return;
    }
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
    this.proc = proc;
    log.info(`Advertising "${advert.name}" as ${SERVICE_TYPE} on port ${advert.port}`);
    void proc.exited.then(async (code) => {
      if (this.proc !== proc) return; // replaced or stopped on purpose
      this.proc = undefined;
      const err = (await new Response(proc.stderr as ReadableStream).text().catch(() => "")).trim();
      this.failures++;
      const delay = Math.min(300_000, 5_000 * 2 ** Math.min(this.failures - 1, 6));
      log.warn(`${cmd[0]} exited (${code})${err ? `: ${err.slice(0, 200)}` : ""}; retrying in ${Math.round(delay / 1000)}s`);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        const next = this.advert();
        if (!this.stopped && next && JSON.stringify(next) === this.current) this.spawn(next);
      }, delay);
    });
  }

  private kill() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const proc = this.proc;
    this.proc = undefined;
    proc?.kill();
  }

  stop() {
    this.stopped = true;
    this.kill();
  }
}
