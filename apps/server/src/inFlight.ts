import { runtime } from "#runtime";

/**
 * Whether work one request started may be awaited by another. Not on Workers: they cancel
 * a request's I/O when its client goes away, so the work might never finish and every
 * request waiting on it would hang. There, only finished results are shared.
 */
export const shareInFlight = runtime.name !== "workers";

export interface SharedWorkOptions {
  /** Keep finished values for later callers (a memo), not only share work in progress. */
  remember?: boolean;
  /** Past this many remembered values, the oldest is let go. */
  max?: number;
  /** Remembered values older than this are worked out again. */
  ttlMs?: number;
  /** Whether callers may wait on work another started (default: the runtime's rule above). */
  shareInFlight?: boolean;
}

/**
 * Values by key, each worked out once: callers asking for the same key share the work
 * while it runs (where the runtime allows it) and, with `remember`, its result after.
 * A failure is never kept, so the next caller tries again.
 */
export class SharedWork<K, V> {
  private readonly inProgress = new Map<K, Promise<V>>();
  private readonly done = new Map<K, { value: V; at: number }>();
  private readonly share: boolean;

  constructor(private readonly options: SharedWorkOptions = {}) {
    this.share = options.shareInFlight ?? shareInFlight;
  }

  get(key: K, work: () => Promise<V>): Promise<V> {
    const kept = this.done.get(key);
    if (kept && (this.options.ttlMs === undefined || Date.now() - kept.at < this.options.ttlMs)) return Promise.resolve(kept.value);
    if (kept) this.done.delete(key);
    const running = this.share ? this.inProgress.get(key) : undefined;
    if (running) return running;
    const started = work();
    if (this.share) {
      this.inProgress.set(key, started);
      started.then(
        () => this.inProgress.delete(key),
        () => this.inProgress.delete(key),
      );
    }
    if (this.options.remember) {
      started.then(
        (value) => {
          this.done.delete(key);
          this.done.set(key, { value, at: Date.now() });
          // Maps keep insertion order: the first key is the oldest.
          if (this.options.max !== undefined && this.done.size > this.options.max) this.done.delete(this.done.keys().next().value!);
        },
        () => {},
      );
    }
    return started;
  }

  /** Whether work for `key` is running and may be joined. */
  running(key: K): boolean {
    return this.inProgress.has(key);
  }

  /** Forgets a remembered value (a running one finishes for whoever waits on it). */
  delete(key: K) {
    this.done.delete(key);
  }

  clear() {
    this.done.clear();
  }

  get size() {
    return this.done.size;
  }
}
