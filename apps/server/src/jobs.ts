import { logger } from "./log";

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

/** Named background jobs that run on an interval or on demand, never overlapping. */
export class Jobs {
  private jobs = new Map<string, { fn: JobFn; status: JobStatus; timer?: ReturnType<typeof setTimeout>; intervalMs: number; current?: Promise<void> }>();

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
    if (job.current) return job.current;
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
      });
    return job.current;
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({ ...j.status }));
  }

  stop() {
    for (const job of this.jobs.values()) if (job.timer) clearTimeout(job.timer);
  }
}
