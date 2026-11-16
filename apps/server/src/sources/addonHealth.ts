/**
 * How each of a household's add-ons is doing, as Strata last found it: when it last answered
 * and how fast, its last failure in words, and whether it's paused. Every place that asks
 * an add-on (discovery, subtitles, Home rows, refreshing its manifest) reports here, and
 * the dashboard shows it. Kept in memory: a restart starts afresh (and on Workers, each
 * isolate has its own), which is fine for a status light.
 */
export type HealthState = "ok" | "failing" | "paused" | "unknown";

export interface AddonHealthView {
  state: HealthState;
  /** The last failure, in words ("Didn't answer in time"), when it's failing or paused. */
  message?: string;
  /** When it last answered (ok) or last failed. */
  at?: number;
  /** How long its last answer took. */
  latencyMs?: number;
  /** Until when it's skipped, when paused. */
  pausedUntil?: number;
}

/** Failures in a row before an add-on is paused, and for how long. */
const PAUSE_AFTER = 3;
const PAUSE_MS = 5 * 60_000;

interface Record {
  lastOkAt?: number;
  latencyMs?: number;
  lastError?: string;
  lastErrorAt?: number;
  failures: number;
  pausedUntil?: number;
}

export class AddonPausedError extends Error {
  constructor(name: string) {
    super(`${name} is paused after failing; it's tried again in a few minutes`);
  }
}

export class AddonHealth {
  private records = new Map<string, Record>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Runs one request to an add-on, recording how it went. A paused add-on isn't asked: this
   * throws AddonPausedError instead (failing rather than answering "nothing").
   */
  async track<T>(addonId: string, name: string, run: () => Promise<T>): Promise<T> {
    const r = this.record(addonId);
    if (r.pausedUntil && this.now() < r.pausedUntil) throw new AddonPausedError(name);
    const started = this.now();
    try {
      const value = await run();
      this.ok(addonId, this.now() - started);
      return value;
    } catch (err) {
      this.fail(addonId, err);
      throw err;
    }
  }

  ok(addonId: string, latencyMs?: number) {
    const r = this.record(addonId);
    r.lastOkAt = this.now();
    r.latencyMs = latencyMs;
    r.failures = 0;
    r.pausedUntil = undefined;
  }

  fail(addonId: string, err: unknown) {
    const r = this.record(addonId);
    r.lastError = describeAddonError(err);
    r.lastErrorAt = this.now();
    r.failures++;
    if (r.failures >= PAUSE_AFTER) r.pausedUntil = this.now() + PAUSE_MS;
  }

  /** Forgets an add-on (removed, or pointed at another address). */
  forget(addonId: string) {
    this.records.delete(addonId);
  }

  view(addonId: string): AddonHealthView {
    const r = this.records.get(addonId);
    if (!r || (r.lastOkAt === undefined && r.lastErrorAt === undefined)) return { state: "unknown" };
    const now = this.now();
    if (r.pausedUntil && now < r.pausedUntil) return { state: "paused", message: r.lastError, at: r.lastErrorAt, pausedUntil: r.pausedUntil };
    // The latest outcome decides.
    if (r.failures > 0 && (r.lastErrorAt ?? 0) >= (r.lastOkAt ?? 0)) return { state: "failing", message: r.lastError, at: r.lastErrorAt };
    return { state: "ok", at: r.lastOkAt, latencyMs: r.latencyMs };
  }

  private record(addonId: string): Record {
    let r = this.records.get(addonId);
    if (!r) this.records.set(addonId, (r = { failures: 0 }));
    return r;
  }
}

/** A failure as the dashboard says it: what happened, not a stack trace (nor the add-on's address). */
export function describeAddonError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const status = /\b([45]\d\d)\b/.exec(text)?.[1];
  if (/timed out|timeout|aborted/i.test(text) || (err instanceof Error && err.name === "TimeoutError")) return "Didn't answer in time.";
  if (status === "401" || status === "403") return `Turned Strata away (${status}). It may need setting up again on its configure page.`;
  if (status === "404") return "Answered 404: the add-on doesn't have that, or its address changed.";
  if (status === "429") return "Asked to slow down (429): too many requests for now.";
  if (status && status.startsWith("5")) return `Had a problem on its side (${status}).`;
  if (/too large/i.test(text)) return "Answered with more than Strata reads.";
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|Couldn't find that add-on's address/i.test(text)) return "Its address couldn't be found.";
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket|unreachable|certificate|TLS/i.test(text)) return "Couldn't be reached.";
  if (/redirect/i.test(text)) return "Redirected somewhere Strata doesn't follow.";
  if (/home network|private network|localhost/i.test(text)) return "Its address is on a private network.";
  if (err instanceof SyntaxError || /Unexpected token|not valid JSON/i.test(text)) return "Answered with something that isn't an add-on's answer.";
  return "Failed to answer.";
}
