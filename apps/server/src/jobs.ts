import { logger } from "./log";
import { shareInFlight } from "./inFlight";

const log = logger("jobs");

export interface JobStatus {
  name: string;
  running: boolean;
  progress?: { done: number; total: number; label?: string };
  lastRunAt?: number;
  lastDurationMs?: number;
  lastError?: string;
  lastResult?: unknown;
  nextRunAt?: number;
}

type JobFn = (report: (done: number, total: number, label?: string) => void) => Promise<unknown>;

/** How a job's last run is kept, where servers share the database (the cloud). */
export type SavedRun = Pick<JobStatus, "lastRunAt" | "lastDurationMs" | "lastError">;
export interface JobHistory {
  load(): Promise<Record<string, SavedRun>>;
  save(name: string, run: SavedRun): Promise<void>;
}

/**
 * Named background jobs that run on an interval or on demand, never overlapping. With a
 * `history` (the cloud: jobs run on whichever instance a cron or a request lands on) each
 * run is recorded, and `statusNow` reports the latest from any of them; `nextRun` says
 * when one runs next where something other than this process schedules it.
 */
export class Jobs {
  private jobs = new Map<string, { fn: JobFn; status: JobStatus; timer?: ReturnType<typeof setTimeout>; intervalMs: number; current?: Promise<void> }>();

  constructor(private readonly options: { history?: JobHistory; nextRun?: (name: string) => number | undefined } = {}) {}

  register(name: string, fn: JobFn) {
    this.jobs.set(name, { fn, status: { name, running: false }, intervalMs: 0 });
  }

  /** Schedules repeats; 0 disables. The first run happens after `initialDelayMs`. */
  schedule(name: string, intervalMs: number, initialDelayMs = intervalMs) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job ${name}`);
    if (job.timer) clearTimeout(job.timer);
    job.intervalMs = intervalMs;
    job.status.nextRunAt = undefined;
    if (intervalMs <= 0) return;
    job.status.nextRunAt = Date.now() + initialDelayMs;
    job.timer = setTimeout(() => void this.run(name), initialDelayMs);
  }

  /** Runs now (or joins the in-flight run). */
  run(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job ${name}`);
    // On Workers a run another request started might never finish (see inFlight.ts).
    if (job.current && shareInFlight) return job.current;
    if (job.timer) clearTimeout(job.timer);
    const started = Date.now();
    job.status.running = true;
    job.status.progress = undefined;
    job.current = job
      .fn((done, total, label) => (job.status.progress = { done, total, label }))
      .then(
        (result) => {
          job.status.lastResult = result;
          job.status.lastError = undefined;
        },
        (err: unknown) => {
          job.status.lastError = err instanceof Error ? err.message : String(err);
          log.error(`Job ${name} failed`, err);
        },
      )
      .finally(() => {
        job.status.running = false;
        job.status.progress = undefined;
        job.status.lastRunAt = started;
        job.status.lastDurationMs = Date.now() - started;
        job.current = undefined;
        if (job.intervalMs > 0) this.schedule(name, job.intervalMs);
      })
      .then(() => {
        const { lastRunAt, lastDurationMs, lastError } = job.status;
        return this.options.history?.save(name, { lastRunAt, lastDurationMs, lastError }).catch((err) => log.warn(`Couldn't record job ${name}`, err));
      });
    return job.current;
  }

  /** Every job's status, with the latest recorded run (from any server) and its next scheduled run. */
  async statusNow(): Promise<JobStatus[]> {
    const saved: Record<string, SavedRun> = (await this.options.history?.load().catch(() => ({}))) ?? {};
    return this.status().map((s) => {
      const recorded = saved[s.name];
      const newer = recorded?.lastRunAt && (!s.lastRunAt || recorded.lastRunAt > s.lastRunAt) ? recorded : undefined;
      return { ...s, ...(newer ?? {}), nextRunAt: s.nextRunAt ?? this.options.nextRun?.(s.name) };
    });
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({ ...j.status }));
  }

  stop() {
    for (const job of this.jobs.values()) if (job.timer) clearTimeout(job.timer);
  }
}
